import { randomUUID } from 'node:crypto';
import type { ValidateFunction } from 'ajv';
import { z } from 'zod';
import {
  assertOperationCurrent,
  captureOperationContext,
  type ProviderOperationContext,
  withOperationContext,
} from '../providers/operation-context.js';
import { createContractAjv } from './ajv.js';
import {
  defaultPackageRoot,
  type IntegrationLoadFailure,
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
  matchesIntegrationCompatibility,
  parseFoundryGeneration,
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

interface PackageVariants {
  packages: IntegrationPackage[];
  failures: IntegrationLoadFailure[];
}

interface IntegrationCall {
  name: string;
  revision: number;
  context: ProviderOperationContext | undefined;
  possibleWrites: number;
  pendingWrites: Set<Promise<unknown>>;
}

const UNCERTAIN_WRITE_ERRORS = new Set([
  'worker_timeout',
  'worker_exited',
  'worker_protocol',
  'protocol_limit',
  'worker_unavailable',
  'python_unavailable',
  'stale_session',
  'session_changed',
  'session_closed',
  'invalid_output',
  'adapter_error',
  'provider_error',
]);

// These execution errors attest that this particular binding did not mutate
// Foundry. A provider must use outcome_unknown for a response lost after sending.
const CONFIRMED_NO_WRITE_ERRORS = new Set([
  'session_changed',
  'session_closed',
  'target_offline',
  'target_unavailable',
  'writes_disabled',
  'unsupported_operation',
  'identity_mismatch',
  'execution_rejected',
]);

/** Session-owned integration instances; package definitions never contain connection credentials. */
export class IntegrationManager {
  private readonly ajv = createContractAjv();
  private readonly packageRoot: string;
  private worker: PythonWorker | undefined;
  private operations = new Map<string, RegisteredOperation>();
  private statuses: IntegrationStatus[] = [];
  private calls = new Map<string, IntegrationCall>();
  private readonly interruptedWrites = new Set<Promise<unknown>>();
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
    const failures: IntegrationLoadFailure[] = [];
    const packages = await loadIntegrations(this.packageRoot, {
      onError: (failure) => failures.push(failure),
    });
    if (revision !== this.revision || this.closed) {
      return;
    }
    const groups = new Map<string, PackageVariants>();
    for (const entry of packages) {
      const key = `${entry.manifest.kind}:${entry.manifest.id}`;
      const group: PackageVariants = groups.get(key) ?? { packages: [], failures: [] };
      group.packages.push(entry);
      groups.set(key, group);
    }
    for (const failure of failures) {
      const key = `${failure.kind}:${failure.id}`;
      const group: PackageVariants = groups.get(key) ?? { packages: [], failures: [] };
      group.failures.push(failure);
      groups.set(key, group);
    }
    this.statuses = [];
    const candidates: Array<{ entry: IntegrationPackage; status: IntegrationStatus }> = [];
    for (const [, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      const { entry, status } = this.select(group.packages, group.failures, environment);
      this.statuses.push(status);
      if (entry && status.state === 'not-ready' && status.reason === undefined) {
        candidates.push({ entry, status });
      }
    }
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
        if (revision === this.revision && this.worker === worker) {
          // Invalidate every continuation of the activation, including a remote
          // probe already awaiting its response when this worker exits.
          this.revision += 1;
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
    const current = () =>
      revision === this.revision && !this.closed && this.worker === worker && worker.isRunning();
    try {
      await worker.start();
      for (const { entry, status } of candidates) {
        if (!current()) {
          return;
        }
        try {
          const key = `${entry.manifest.kind}:${entry.manifest.id}`;
          await worker.load(
            key,
            entry.root,
            entry.manifest.entrypoint,
            entry.manifest.foundryGeneration,
          );
          if (!current()) {
            return;
          }
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
              if (!current()) {
                return;
              }
              available.available = true;
              delete available.reason;
              this.operations.set(name, operation);
            } catch (error) {
              if (!current()) {
                return;
              }
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
          if (!current()) {
            return;
          }
          status.state = 'error';
          status.reason = error instanceof Error ? error.message : String(error);
          for (const operation of status.operations) {
            this.operations.delete(operation.name);
            operation.available = false;
            operation.reason = status.reason;
          }
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
      ...(status.availableGenerations
        ? { availableGenerations: [...status.availableGenerations] }
        : {}),
      ...(status.variantErrors
        ? { variantErrors: status.variantErrors.map((error) => ({ ...error })) }
        : {}),
      operations: status.operations.map((operation) => ({ ...operation })),
    }));
  }

  has(name: string): boolean {
    return this.operations.has(name);
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (this.interruptedWrites.size > 0) {
      throw new IntegrationError(
        'operation_pending',
        'An earlier integration write is still settling; it must not be replayed',
      );
    }
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
    const call: IntegrationCall = {
      name,
      revision,
      context: captureOperationContext(),
      possibleWrites: 0,
      pendingWrites: new Set(),
    };
    this.calls.set(token, call);
    try {
      const result = await worker.call(
        `${operation.package.manifest.kind}:${operation.package.manifest.id}`,
        operation.definition.id,
        args,
        token,
      );
      // A trusted adapter must not report completion while its own write callback
      // is still running, even if it forgot to await context.invoke().
      await Promise.all([...call.pendingWrites]);
      if (revision !== this.revision || this.closed) {
        throw new IntegrationError(
          'stale_session',
          'The integration result belongs to an earlier session',
        );
      }
      this.validate(operation.output, result, 'output');
      return result;
    } catch (error) {
      if (
        call.possibleWrites > 0 &&
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        UNCERTAIN_WRITE_ERRORS.has(error.code)
      ) {
        throw new IntegrationError(
          'outcome_unknown',
          `Integration ${name} lost its result after a write was dispatched. Its outcome is unknown; it was not retried (${error.code})`,
        );
      }
      throw error;
    } finally {
      this.calls.delete(token);
      // The session tracks the actual provider request through its operation
      // context. Standalone managers also reject a replay while that write drains.
      for (const pending of call.pendingWrites) {
        this.interruptedWrites.add(pending);
        const settled = () => {
          this.interruptedWrites.delete(pending);
        };
        void pending.then(settled, settled);
      }
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
    const execution = withOperationContext(call.context, async () => {
      // The Python stdout listener was installed outside the original call's
      // async context; restore its fence before marking or dispatching a write.
      assertOperationCurrent();
      if (!operation.definition.readOnly) {
        call.possibleWrites += 1;
      }
      try {
        return await this.options.execute(
          operation.script,
          request.arguments,
          operation.definition.readOnly,
        );
      } catch (error) {
        if (
          !operation.definition.readOnly &&
          error instanceof Error &&
          'code' in error &&
          typeof error.code === 'string' &&
          CONFIRMED_NO_WRITE_ERRORS.has(error.code)
        ) {
          call.possibleWrites -= 1;
        }
        throw error;
      }
    });
    if (!operation.definition.readOnly) {
      call.pendingWrites.add(execution);
      const settled = () => {
        call.pendingWrites.delete(execution);
      };
      void execution.then(settled, settled);
    }
    const result = await execution;
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

  /** Choose exactly one package before importing Python or probing any runtime. */
  private select(
    packages: IntegrationPackage[],
    failures: IntegrationLoadFailure[],
    environment: IntegrationEnvironment,
  ): { entry?: IntegrationPackage; status: IntegrationStatus } {
    const identity = packages[0]?.manifest ?? failures[0];
    if (!identity) {
      throw new IntegrationError('invalid_manifest', 'An integration group has no identity');
    }
    const generation = parseFoundryGeneration(environment.foundryVersion);
    const availableGenerations = [
      ...new Set(
        packages.flatMap((entry) =>
          entry.manifest.foundryGeneration === undefined ? [] : [entry.manifest.foundryGeneration],
        ),
      ),
    ].sort((a, b) => a - b);
    const variantErrors = failures.map((failure) => ({
      ...(failure.foundryGeneration === undefined
        ? {}
        : { foundryGeneration: failure.foundryGeneration }),
      reason: failure.error.message,
    }));
    const details = {
      availableGenerations,
      ...(variantErrors.length ? { variantErrors } : {}),
    };
    const relevantFailures = failures.filter(
      (failure) =>
        failure.foundryGeneration === undefined || failure.foundryGeneration === generation,
    );
    if (relevantFailures.length) {
      const reason = relevantFailures.map((failure) => failure.error.message).join('; ');
      return {
        status: {
          kind: identity.kind,
          id: identity.id,
          adapterVersion: relevantFailures[0]?.adapterVersion ?? 'unknown',
          ...details,
          state: 'error',
          reason,
          operations: [...new Set(relevantFailures.flatMap((failure) => failure.operations))].map(
            (name) => ({ name, available: false, reason }),
          ),
        },
      };
    }
    const entry = packages.find(
      (candidate) =>
        candidate.manifest.foundryGeneration === undefined ||
        candidate.manifest.foundryGeneration === generation,
    );
    if (entry) {
      return {
        entry,
        status: {
          ...this.status(entry, environment),
          ...(entry.manifest.foundryGeneration === undefined
            ? {}
            : { foundryGeneration: entry.manifest.foundryGeneration }),
          ...details,
        },
      };
    }
    const installed =
      identity.kind === 'system'
        ? environment.system.id === identity.id
          ? { ...environment.system, active: true }
          : undefined
        : environment.modules.find((module) => module.id === identity.id);
    const status: IntegrationStatus = {
      kind: identity.kind,
      id: identity.id,
      adapterVersion: 'unavailable',
      ...details,
      state: 'incompatible',
      operations: [],
      reason:
        generation === undefined
          ? `Cannot select an integration variant from unknown Foundry version ${JSON.stringify(environment.foundryVersion)}`
          : `No integration variant for Foundry generation ${generation}; available generations: ${availableGenerations.join(', ') || 'none'}`,
    };
    if (!installed) {
      status.state = 'absent';
      status.reason = `${identity.kind} ${identity.id} is not selected or installed on this target`;
    } else {
      status.installedVersion = installed.version;
      if (!installed.active) {
        status.state = 'inactive';
        status.reason = `${identity.id} is inactive on this target`;
      }
    }
    return { status };
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
        !matchesIntegrationCompatibility(manifest.compatibility, {
          systemId: environment.system.id,
          foundryVersion: environment.foundryVersion,
          integrationVersion: installed.version,
        })
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
