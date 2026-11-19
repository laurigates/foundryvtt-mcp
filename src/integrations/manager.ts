import { randomUUID } from 'node:crypto';
import Ajv, { type ValidateFunction } from 'ajv';
import { z } from 'zod';
import {
  defaultPackageRoot,
  type IntegrationOperation,
  type IntegrationPackage,
  loadIntegrations,
  toolName,
} from './manifest.js';
import { PythonWorker, type WorkerInvocation } from './python-worker.js';
import {
  type IntegrationEnvironment,
  IntegrationError,
  type IntegrationStatus,
  type IntegrationTool,
} from './types.js';

const ProbeResult = z.object({ ready: z.boolean(), reason: z.string().optional() });

export interface IntegrationManagerOptions {
  targetId: string;
  pythonExecutable?: string;
  timeoutMs?: number;
  packageRoot?: string;
  writesEnabled?: boolean;
  execute: (script: string, args: Record<string, unknown>, readOnly: boolean) => Promise<unknown>;
  onChange?: () => void;
}

interface RegisteredOperation {
  package: IntegrationPackage;
  definition: IntegrationOperation;
  input: ValidateFunction;
  output: ValidateFunction;
  script: string;
  probe: string;
}

/** Session-owned integration instances; package definitions never contain connection credentials. */
export class IntegrationManager {
  private readonly ajv = new Ajv({ allErrors: true, strict: true });
  private readonly packageRoot: string;
  private worker: PythonWorker | undefined;
  private operations = new Map<string, RegisteredOperation>();
  private statuses: IntegrationStatus[] = [];
  private calls = new Map<string, { name: string; revision: number }>();
  private revision = 0;
  private closed = false;

  constructor(private readonly options: IntegrationManagerOptions) {
    this.packageRoot = options.packageRoot ?? defaultPackageRoot();
  }

  async reconcile(environment: IntegrationEnvironment, generation: number): Promise<void> {
    if (this.closed) {
      throw new IntegrationError('session_closed', 'Integration manager is closed');
    }
    const revision = ++this.revision;
    this.operations.clear();
    this.calls.clear();
    const oldWorker = this.worker;
    this.worker = undefined;
    await oldWorker?.close();
    const packages = await loadIntegrations(this.packageRoot);
    if (revision !== this.revision || this.closed) {
      return;
    }
    this.statuses = packages.map((entry) => this.status(entry, environment));
    const candidates = packages.filter((_, index) => {
      const status = this.statuses[index];
      return status?.state === 'not-ready' && status.reason === undefined;
    });
    if (candidates.length === 0) {
      this.options.onChange?.();
      return;
    }
    const worker = new PythonWorker({
      targetId: this.options.targetId,
      generation,
      packageRoot: this.packageRoot,
      ...(this.options.pythonExecutable ? { executable: this.options.pythonExecutable } : {}),
      ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
      invoke: (request) => this.invoke(request, revision),
      onFailure: (error) => {
        if (revision === this.revision) {
          this.operations.clear();
          this.calls.clear();
          for (const status of this.statuses) {
            if (status.state === 'ready' || status.state === 'not-ready') {
              status.state = 'error';
              status.reason = error.message;
              for (const operation of status.operations) {
                operation.available = false;
                operation.reason = error.message;
              }
            }
          }
          this.options.onChange?.();
        }
      },
    });
    this.worker = worker;
    try {
      await worker.start();
      for (const entry of candidates) {
        if (revision !== this.revision || this.closed) {
          return;
        }
        const status = this.statuses.find(
          (candidate) =>
            candidate.kind === entry.manifest.kind && candidate.id === entry.manifest.id,
        );
        if (!status) {
          continue;
        }
        try {
          const key = `${entry.manifest.kind}:${entry.manifest.id}`;
          await worker.load(key, entry.root, entry.manifest.entrypoint);
          for (const definition of entry.manifest.operations) {
            const name = toolName(entry.manifest.kind, entry.manifest.id, definition.id);
            const binding = entry.bindings.get(definition.id);
            if (!binding) {
              throw new IntegrationError('invalid_manifest', `Missing binding for ${name}`);
            }
            const operation: RegisteredOperation = {
              package: entry,
              definition,
              input: this.ajv.compile(definition.inputSchema),
              output: this.ajv.compile(definition.outputSchema),
              script: binding.script,
              probe: binding.probe,
            };
            const available = status.operations.find((candidate) => candidate.name === name);
            if (!available) {
              continue;
            }
            try {
              if (!definition.readOnly && !this.options.writesEnabled) {
                throw new IntegrationError(
                  'writes_disabled',
                  'Writes are disabled for this target',
                );
              }
              await this.probe(operation);
              if (revision !== this.revision || this.closed) {
                return;
              }
              available.available = true;
              delete available.reason;
              this.operations.set(name, operation);
            } catch (error) {
              available.reason = error instanceof Error ? error.message : String(error);
            }
          }
          status.state = status.operations.some((operation) => operation.available)
            ? 'ready'
            : 'not-ready';
          if (status.state === 'ready') {
            delete status.reason;
          } else {
            status.reason =
              status.operations.find((operation) => operation.reason)?.reason ??
              'No operation is ready';
          }
        } catch (error) {
          status.state = 'error';
          status.reason = error instanceof Error ? error.message : String(error);
        }
      }
    } catch (error) {
      if (revision === this.revision) {
        for (const status of this.statuses) {
          if (status.state === 'not-ready') {
            status.state = 'error';
            status.reason = error instanceof Error ? error.message : String(error);
          }
        }
      }
    }
    this.options.onChange?.();
  }

  getTools(): IntegrationTool[] {
    return [...this.operations].map(([name, operation]) => ({
      name,
      description: `${operation.definition.description} Adapter status: ${operation.package.manifest.status}.`,
      inputSchema: operation.definition.inputSchema,
      outputSchema: operation.definition.outputSchema,
      readOnly: operation.definition.readOnly,
    }));
  }

  list(): IntegrationStatus[] {
    return this.statuses.map((status) => ({
      ...status,
      operations: status.operations.map((operation) => ({ ...operation })),
    }));
  }

  has(name: string): boolean {
    return this.operations.has(name);
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const operation = this.operations.get(name);
    const worker = this.worker;
    if (this.closed || !operation || !worker) {
      throw new IntegrationError(
        'integration_unavailable',
        `${name} is unavailable on target ${this.options.targetId}`,
      );
    }
    this.validate(operation.input, args, 'input');
    if (!operation.definition.readOnly && !this.options.writesEnabled) {
      throw new IntegrationError('writes_disabled', 'Writes are disabled for this target');
    }
    const revision = this.revision;
    try {
      await this.probe(operation);
    } catch (error) {
      if (revision === this.revision) {
        this.operations.delete(name);
        const status = this.statuses.find(
          (entry) =>
            entry.kind === operation.package.manifest.kind &&
            entry.id === operation.package.manifest.id,
        );
        const registered = status?.operations.find((entry) => entry.name === name);
        const reason = error instanceof Error ? error.message : String(error);
        if (registered) {
          registered.available = false;
          registered.reason = reason;
        }
        if (status && !status.operations.some((entry) => entry.available)) {
          status.state = 'not-ready';
          status.reason = reason;
        }
        this.options.onChange?.();
      }
      throw error;
    }
    if (revision !== this.revision || this.closed) {
      throw new IntegrationError(
        'stale_session',
        'The integration session changed before execution',
      );
    }
    const token = randomUUID();
    this.calls.set(token, { name, revision });
    try {
      const result = await worker.call(
        `${operation.package.manifest.kind}:${operation.package.manifest.id}`,
        operation.definition.id,
        args,
        token,
      );
      if (revision !== this.revision || this.closed) {
        throw new IntegrationError(
          'stale_session',
          'The integration result belongs to an earlier session',
        );
      }
      this.validate(operation.output, result, 'output');
      return result;
    } finally {
      this.calls.delete(token);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.revision += 1;
    this.operations.clear();
    this.calls.clear();
    for (const status of this.statuses) {
      if (status.state === 'ready' || status.state === 'not-ready') {
        status.state = 'not-ready';
        status.reason = 'Integration session closed; reconnect or refresh the target';
      }
      for (const operation of status.operations) {
        operation.available = false;
        if (status.reason) {
          operation.reason = status.reason;
        }
      }
    }
    await this.worker?.close();
    this.worker = undefined;
    this.options.onChange?.();
  }

  private async invoke(request: WorkerInvocation, revision: number): Promise<unknown> {
    const call = this.calls.get(request.callToken);
    const operation = call ? this.operations.get(call.name) : undefined;
    if (
      !call ||
      !operation ||
      call.revision !== revision ||
      revision !== this.revision ||
      this.closed
    ) {
      throw new IntegrationError('stale_session', 'Unrecognized or expired integration invocation');
    }
    const identity = `${operation.package.manifest.kind}:${operation.package.manifest.id}`;
    if (request.integration !== identity || request.operation !== operation.definition.id) {
      throw new IntegrationError(
        'invalid_binding',
        'An adapter may invoke only its registered operation binding',
      );
    }
    this.validate(operation.input, request.arguments, 'input');
    if (!operation.definition.readOnly && !this.options.writesEnabled) {
      throw new IntegrationError('writes_disabled', 'Writes are disabled for this target');
    }
    const result = await this.options.execute(
      operation.script,
      request.arguments,
      operation.definition.readOnly,
    );
    if (revision !== this.revision || this.closed) {
      throw new IntegrationError(
        'stale_session',
        'Provider result belongs to an earlier integration session',
      );
    }
    this.validate(operation.output, result, 'output');
    return result;
  }

  private async probe(operation: RegisteredOperation): Promise<void> {
    const response = ProbeResult.parse(await this.options.execute(operation.probe, {}, true));
    if (!response.ready) {
      throw new IntegrationError(
        'integration_not_ready',
        response.reason ?? 'Integration runtime API is unavailable',
      );
    }
  }

  private validate(
    validator: ValidateFunction,
    value: unknown,
    direction: 'input' | 'output',
  ): void {
    if (!validator(value)) {
      throw new IntegrationError(
        `invalid_${direction}`,
        `Invalid integration ${direction}: ${this.ajv.errorsText(validator.errors)}`,
      );
    }
  }

  private status(
    entry: IntegrationPackage,
    environment: IntegrationEnvironment,
  ): IntegrationStatus {
    const { manifest } = entry;
    const status: IntegrationStatus = {
      kind: manifest.kind,
      id: manifest.id,
      adapterVersion: manifest.adapterVersion,
      state: 'not-ready',
      operations: manifest.operations.map((operation) => ({
        name: toolName(manifest.kind, manifest.id, operation.id),
        available: false,
      })),
    };
    const installed =
      manifest.kind === 'system'
        ? environment.system.id === manifest.id
          ? { ...environment.system, active: true }
          : undefined
        : environment.modules.find((module) => module.id === manifest.id);
    if (!installed) {
      status.state = 'absent';
      status.reason = `${manifest.kind} ${manifest.id} is not selected or installed on this target`;
    } else {
      status.installedVersion = installed.version;
      if (!installed.active) {
        status.state = 'inactive';
        status.reason = `${manifest.id} is inactive on this target`;
      } else if (
        (manifest.compatibility.systems &&
          !manifest.compatibility.systems.includes(environment.system.id)) ||
        (manifest.compatibility.foundryVersions.length > 0 &&
          !manifest.compatibility.foundryVersions.includes(environment.foundryVersion)) ||
        (manifest.compatibility.integrationVersions.length > 0 &&
          !manifest.compatibility.integrationVersions.includes(installed.version))
      ) {
        status.state = 'incompatible';
        status.reason = 'The installed versions or system do not match the declared compatibility';
      } else if (environment.runtimeAvailable === false) {
        status.state = 'unsupported';
        status.reason = 'The selected provider does not support runtime.execute';
      } else if (environment.ready === false) {
        status.state = 'not-ready';
        status.reason = 'The Foundry runtime is not ready';
      }
    }
    return status;
  }
}
