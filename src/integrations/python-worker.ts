import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import { z } from 'zod';
import { IntegrationError } from './types.js';

const MessageSchema = z.object({
  type: z.enum(['request', 'response']),
  id: z.string(),
  generation: z.number().int(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

const InvokeSchema = z.object({
  integration: z.string(),
  operation: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  callToken: z.string(),
});

export type WorkerInvocation = z.infer<typeof InvokeSchema>;

export interface PythonWorkerOptions {
  targetId: string;
  generation: number;
  packageRoot: string;
  executable?: string;
  timeoutMs?: number;
  invoke: (request: WorkerInvocation) => Promise<unknown>;
  onFailure?: (error: Error) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** One process per target; its stdout is a private protocol pipe, never MCP stdout. */
export class PythonWorker {
  private child: ChildProcessWithoutNullStreams | undefined;
  private reader: Interface | undefined;
  private pending = new Map<string, PendingRequest>();
  private stopped = false;
  private stderr = '';

  constructor(private readonly options: PythonWorkerOptions) {}

  async start(): Promise<void> {
    if (this.child || this.stopped) {
      throw new IntegrationError('worker_state', 'The Python worker cannot be started twice');
    }
    const entrypoint = resolve(this.options.packageRoot, 'python/foundry_mcp_modules/worker.py');
    this.child = spawn(this.options.executable ?? 'python3', ['-I', '-B', '-u', entrypoint], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.environment(),
    });
    this.child.on('error', (error) =>
      this.fail(new IntegrationError('python_unavailable', error.message)),
    );
    this.child.on('exit', (code, signal) => {
      if (!this.stopped) {
        this.fail(
          new IntegrationError(
            'worker_exited',
            `Python worker exited (${code ?? signal}). ${this.stderr}`,
          ),
        );
      }
    });
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString('utf8')}`.slice(-4096);
    });
    this.reader = createInterface({
      input: this.child.stdout,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    this.reader.on('line', (line) => {
      void this.receive(line).catch((error: unknown) =>
        this.fail(error instanceof Error ? error : new Error(String(error))),
      );
    });
    const result = await this.request('handshake', {
      version: 1,
      targetId: this.options.targetId,
      packageRoot: this.options.packageRoot,
    });
    z.object({ version: z.literal(1), targetId: z.literal(this.options.targetId) }).parse(result);
  }

  async load(key: string, root: string, entrypoint: string): Promise<void> {
    await this.request('load', { integration: key, root, entrypoint });
  }

  async call(
    key: string,
    operation: string,
    args: Record<string, unknown>,
    callToken: string,
  ): Promise<unknown> {
    return this.request('call', { integration: key, operation, arguments: args, callToken });
  }

  async close(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.rejectPending(new IntegrationError('session_closed', 'Integration session closed'));
    this.reader?.close();
    const child = this.child;
    if (!child) {
      return;
    }
    child.stdin.end();
    child.kill('SIGTERM');
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    await new Promise<void>((done) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        done();
      }, 1000);
      child.once('exit', () => {
        clearTimeout(timer);
        done();
      });
    });
  }

  private environment(): NodeJS.ProcessEnv {
    // Provider credentials and unrelated process secrets are not inherited by adapters.
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }
    return env;
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.child || this.stopped) {
      return Promise.reject(
        new IntegrationError('worker_unavailable', 'Python worker is unavailable'),
      );
    }
    const id = `node:${randomUUID()}`;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.fail(new IntegrationError('worker_timeout', `Python ${method} request timed out`));
      }, this.options.timeoutMs ?? 30000);
      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      this.write({ type: 'request', id, generation: this.options.generation, method, params });
    });
  }

  private write(message: Record<string, unknown>): void {
    if (this.stopped || !this.child || this.child.stdin.destroyed) {
      return;
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private async receive(line: string): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (line.length > 8 * 1024 * 1024) {
      throw new IntegrationError('worker_protocol', 'Python message exceeds the protocol limit');
    }
    const message = MessageSchema.parse(JSON.parse(line));
    if (message.generation !== this.options.generation) {
      throw new IntegrationError(
        'stale_session',
        'Python response belongs to another session generation',
      );
    }
    if (message.type === 'response') {
      const request = this.pending.get(message.id);
      if (!request) {
        throw new IntegrationError('worker_protocol', `Unexpected Python response: ${message.id}`);
      }
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) {
        request.reject(new IntegrationError(message.error.code, message.error.message));
      } else {
        request.resolve(message.result);
      }
      return;
    }
    if (message.method !== 'invoke') {
      throw new IntegrationError(
        'worker_protocol',
        `Unsupported Python request: ${message.method}`,
      );
    }
    try {
      const result = await this.options.invoke(InvokeSchema.parse(message.params));
      this.write({ type: 'response', id: message.id, generation: message.generation, result });
    } catch (error) {
      this.write({
        type: 'response',
        id: message.id,
        generation: message.generation,
        error: {
          code:
            error instanceof Error && 'code' in error && typeof error.code === 'string'
              ? error.code
              : 'provider_error',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private fail(error: Error): void {
    if (this.stopped) {
      return;
    }
    this.rejectPending(error);
    this.options.onFailure?.(error);
    void this.close();
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}
