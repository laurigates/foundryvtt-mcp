import { legacyConfigForTarget, type TargetConfig } from '../config/targets.js';
import { DiagnosticsClient } from '../diagnostics/client.js';
import { IntegrationManager, type IntegrationManagerOptions } from '../integrations/manager.js';
import {
  assertOperationCurrent,
  ProviderOperationContext,
  trackOperation,
  withOperationContext,
} from '../providers/operation-context.js';
import type { FoundryEnvironment, FoundryProvider } from '../providers/types.js';
import { DiagnosticSystem } from '../utils/diagnostics.js';

export type SessionState = 'idle' | 'connecting' | 'ready' | 'offline' | 'error' | 'closed';
export type SessionIntegrations = Pick<
  IntegrationManager,
  'reconcile' | 'getTools' | 'list' | 'has' | 'call' | 'close'
>;

export class SessionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

export interface SessionOptions {
  integrationFactory?: (options: IntegrationManagerOptions) => SessionIntegrations;
  monitorIntervalMs?: number;
  packageRoot?: string;
  onChange?: () => void;
}

export interface SessionStatus {
  target_id: string;
  label: string;
  state: SessionState;
  provider: string;
  generation: number;
  writeEnabled: boolean;
  capabilities: string[];
  world?: { id: string; title: string };
  system?: { id: string; version: string };
  foundryVersion?: string;
  integrations: ReturnType<SessionIntegrations['list']>;
  error?: string;
  integrationError?: string;
}

/** Captured at dispatch; transport generation is internal and is not sent in MCP metadata. */
export interface SessionContext {
  readonly target_id: string;
  readonly world_id: string | null;
  readonly session_generation: number;
  readonly provider_generation: number;
}

/** A target owns its provider, caches, diagnostics and Python integration process. */
export class FoundrySession {
  readonly diagnosticsClient: DiagnosticsClient;
  readonly diagnosticSystem: DiagnosticSystem;
  integrations: SessionIntegrations;
  generation = 0;
  environment: FoundryEnvironment | undefined;
  error: string | undefined;
  private integrationError: string | undefined;
  private currentState: SessionState = 'idle';
  private providerGeneration = -1;
  private boundWorldId: string | undefined;
  private boundOrigin: string | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  private monitor: ReturnType<typeof setInterval> | undefined;
  private lifecycle: Promise<void> = Promise.resolve();
  private lifecycleBusy = false;
  private readonly pending = new Set<() => void>();
  private dispatch: Promise<void> = Promise.resolve();

  constructor(
    readonly config: TargetConfig,
    readonly provider: FoundryProvider,
    private readonly options: SessionOptions = {},
  ) {
    this.diagnosticsClient = new DiagnosticsClient(provider);
    const connection = legacyConfigForTarget(config);
    this.diagnosticSystem = new DiagnosticSystem(provider, {
      url: connection.url,
      ...(connection.apiKey !== undefined ? { apiKey: connection.apiKey } : {}),
      ...(connection.username !== undefined ? { username: connection.username } : {}),
      ...(connection.password !== undefined ? { password: connection.password } : {}),
    });
    this.integrations = this.createIntegrations();
  }

  /** Live transport loss is visible immediately, even before the lifecycle monitor runs. */
  get state(): SessionState {
    if (
      this.currentState === 'ready' &&
      (!this.provider.isConnected() || this.provider.getGeneration() !== this.providerGeneration)
    ) {
      return 'offline';
    }
    return this.currentState;
  }

  status(): SessionStatus {
    const state = this.state;
    const error =
      this.error ??
      (state === 'offline'
        ? 'The target connection changed or is unavailable; its context must be refreshed'
        : undefined);
    return {
      target_id: this.config.id,
      label: this.config.label ?? this.config.id,
      state,
      provider: this.provider.kind,
      generation: this.generation,
      writeEnabled: this.config.writeEnabled,
      capabilities: [...this.provider.capabilities].sort(),
      integrations: this.integrations.list(),
      ...(this.environment
        ? {
            world: { ...this.environment.world },
            system: { ...this.environment.system },
            foundryVersion: this.environment.foundryVersion,
          }
        : {}),
      ...(error !== undefined ? { error } : {}),
      ...(this.integrationError !== undefined ? { integrationError: this.integrationError } : {}),
    };
  }

  async start(): Promise<void> {
    await this.enqueue(async () => {
      if (this.currentState === 'ready') {
        return;
      }
      await this.establish('connect');
    });
    this.startMonitor();
  }

  async reconnect(): Promise<void> {
    return this.enqueue(async () => {
      this.advanceGeneration();
      this.currentState = 'connecting';
      await this.integrations.close();
      await this.provider.disconnect();
      await this.establish('connect');
      this.startMonitor();
    });
  }

  async refresh(): Promise<void> {
    await this.refreshWithContext();
  }

  /** Keep refresh provenance tied to the lifecycle that produced its snapshot. */
  async refreshWithContext(): Promise<SessionContext> {
    return this.enqueue(async () => {
      await this.establish('refresh');
      return this.captureContext();
    });
  }

  captureContext(): SessionContext {
    return Object.freeze({
      target_id: this.config.id,
      world_id: this.environment?.world.id ?? null,
      session_generation: this.generation,
      provider_generation: this.providerGeneration,
    });
  }

  /** Close the await boundary between run() settling and the caller emitting its result. */
  assertContextCurrent(context: SessionContext, write = false): void {
    if (context.target_id !== this.config.id) {
      throw new SessionError('session_changed', 'Response belongs to a different target');
    }
    this.requireCurrent(context.session_generation, context.provider_generation, write);
    this.requireReady();
  }

  /** The callback is bound to this target for its entire lifetime. No retry or fallback is performed. */
  async run<T>(
    operation: (provider: FoundryProvider) => Promise<T> | T,
    options: { write?: boolean; refreshCache?: boolean } = {},
  ): Promise<T> {
    this.requireReady();
    if (options.write && !this.config.writeEnabled) {
      throw new SessionError('writes_disabled', `Writes are disabled for target ${this.config.id}`);
    }
    const generation = this.generation;
    const providerGeneration = this.providerGeneration;
    let started = false;
    const context = new ProviderOperationContext(() => {
      this.requireCurrent(generation, providerGeneration, false);
      this.requireReady();
    });
    const work = this.dispatch.then(() =>
      withOperationContext(context, async () => {
        // Work submitted before a reconnect must never migrate into the new session.
        this.requireCurrent(generation, providerGeneration, false);
        this.requireReady();
        if (
          options.refreshCache &&
          this.provider.capabilities.has('core.cache') &&
          this.provider.isWorldDataStale()
        ) {
          await this.refreshCache(generation, providerGeneration);
        }
        if (this.provider.kind === 'legacy-rest') {
          await this.verifyLegacyIdentity(generation, providerGeneration);
        }
        this.requireCurrent(generation, providerGeneration, false);
        this.requireReady();
        started = true;
        const value = await operation(this.provider);
        if (this.provider.kind === 'legacy-rest') {
          await this.verifyLegacyIdentity(generation, providerGeneration, options.write === true);
        }
        return value;
      }),
    );
    const result = this.scoped(
      () => work,
      generation,
      providerGeneration,
      () => options.write === true && started,
    );
    // A worker can fail before a provider request it dispatched settles. The
    // caller receives the error promptly, but ordinary work must not overlap
    // that request. Closing/replacing a generation fences old continuations.
    const settle = async () => {
      context.finish();
      await context.drain();
    };
    this.dispatch = work.then(settle, settle);
    return result;
  }

  close(): Promise<void> {
    if (this.closing) {
      return this.closing;
    }
    this.closed = true;
    this.advanceGeneration();
    this.currentState = 'closed';
    if (this.monitor) {
      clearInterval(this.monitor);
    }
    this.monitor = undefined;
    this.options.onChange?.();
    this.closing = (async () => {
      await Promise.allSettled([this.integrations.close(), this.provider.disconnect()]);
      // A connect already in progress must not resurrect a provider after close().
      await this.lifecycle;
      await this.provider.disconnect();
    })();
    return this.closing;
  }

  private createIntegrations(): SessionIntegrations {
    const generation = this.generation;
    const options: IntegrationManagerOptions = {
      targetId: this.config.id,
      pythonExecutable: this.config.pythonExecutable,
      timeoutMs: this.config.integrationTimeoutMs,
      writesEnabled: this.config.writeEnabled,
      execute: async (script, args, readOnly) => {
        if (generation !== this.generation || this.closed || !this.provider.isConnected()) {
          throw new SessionError(
            'session_changed',
            `The execution context for target ${this.config.id} is no longer current`,
          );
        }
        if (!readOnly && !this.config.writeEnabled) {
          throw new SessionError(
            'writes_disabled',
            `Writes are disabled for target ${this.config.id}`,
          );
        }
        if (!readOnly) {
          this.requireReady();
        }
        const providerGeneration = this.provider.getGeneration();
        if (providerGeneration !== this.providerGeneration) {
          throw new SessionError(
            'session_changed',
            `The transport for target ${this.config.id} has changed`,
          );
        }
        return this.scoped(
          () => {
            assertOperationCurrent();
            return trackOperation(this.provider.execute(script, args, { readOnly }));
          },
          generation,
          providerGeneration,
          !readOnly,
        );
      },
      ...(this.options.packageRoot !== undefined ? { packageRoot: this.options.packageRoot } : {}),
      ...(this.options.onChange !== undefined ? { onChange: this.options.onChange } : {}),
    };
    return this.options.integrationFactory?.(options) ?? new IntegrationManager(options);
  }

  private requireReady(): void {
    if (this.state !== 'ready') {
      throw new SessionError(
        'target_unavailable',
        `Target ${this.config.id} is ${this.state}; inspect get_target_status before retrying`,
      );
    }
  }

  private requireCurrent(generation: number, providerGeneration: number, write: boolean): void {
    if (
      generation === this.generation &&
      providerGeneration === this.provider.getGeneration() &&
      !this.closed &&
      this.provider.isConnected()
    ) {
      return;
    }
    if (write) {
      throw new SessionError(
        'outcome_unknown',
        `The connection for target ${this.config.id} changed after a write was started. Its outcome is unknown; it was not retried`,
      );
    }
    throw new SessionError(
      'session_changed',
      `The connection for target ${this.config.id} changed while the request was running`,
    );
  }

  private async scoped<T>(
    operation: () => Promise<T> | T,
    generation: number,
    providerGeneration: number,
    write: boolean | (() => boolean),
  ): Promise<T> {
    const isWrite = () => (typeof write === 'function' ? write() : write);
    let cancel: (() => void) | undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      cancel = () =>
        reject(
          new SessionError(
            isWrite() ? 'outcome_unknown' : 'session_changed',
            isWrite()
              ? `The session for target ${this.config.id} ended after a write started. Its outcome is unknown; it was not retried`
              : `The session for target ${this.config.id} ended while the request was running`,
          ),
        );
    });
    if (cancel) {
      this.pending.add(cancel);
    }
    try {
      const result = await Promise.race([Promise.resolve(operation()), interrupted]);
      this.requireCurrent(generation, providerGeneration, isWrite());
      return result;
    } catch (error) {
      this.requireCurrent(generation, providerGeneration, isWrite());
      throw error;
    } finally {
      if (cancel) {
        this.pending.delete(cancel);
      }
    }
  }

  private advanceGeneration(): number {
    this.generation++;
    // Old callbacks may never settle. They retain their original operation
    // context, which rejects future sends; new sessions get an independent queue.
    this.dispatch = Promise.resolve();
    for (const cancel of this.pending) {
      cancel();
    }
    this.pending.clear();
    return this.generation;
  }

  /**
   * The historical bridge has no identity-bearing response envelope or socket epoch.
   * Probe on both sides of a request and withhold its result if the endpoint changed worlds.
   * This cannot detect an A→B→A switch entirely between the probes.
   */
  private async verifyLegacyIdentity(
    generation: number,
    providerGeneration: number,
    write = false,
  ): Promise<void> {
    const environment = await this.provider.inspect();
    this.requireCurrent(generation, providerGeneration, write);
    try {
      this.assertIdentity(environment);
      if (!environment.ready) {
        throw new SessionError('target_unavailable', 'Foundry runtime is not ready');
      }
    } catch (error) {
      this.currentState = 'error';
      this.error = this.publicError(error);
      this.options.onChange?.();
      throw error;
    }
  }

  /** Snapshot freshness is ordinary serialized work, not a replacement of the target session. */
  private async refreshCache(generation: number, providerGeneration: number): Promise<void> {
    await this.provider.refreshWorldData();
    const environment = await this.provider.inspect();
    this.requireCurrent(generation, providerGeneration, false);
    try {
      this.assertIdentity(environment);
    } catch (error) {
      this.currentState = 'error';
      this.error = this.publicError(error);
      this.options.onChange?.();
      throw error;
    }
    const context = (value: FoundryEnvironment | undefined) =>
      value
        ? JSON.stringify({
            foundryVersion: value.foundryVersion,
            system: value.system,
            ready: value.ready,
            modules: [...value.modules].sort((a, b) => a.id.localeCompare(b.id)),
          })
        : '';
    const changed = context(this.environment) !== context(environment);
    this.environment = environment;
    if (changed && this.config.integrationsEnabled) {
      try {
        await this.integrations.reconcile(
          { ...environment, runtimeAvailable: this.provider.capabilities.has('runtime.execute') },
          generation,
        );
        this.integrationError = undefined;
      } catch (error) {
        this.integrationError = this.publicError(error);
        await this.integrations.close();
      }
    }
    this.requireCurrent(generation, providerGeneration, false);
    if (!environment.ready) {
      this.currentState = 'offline';
      this.error = 'Foundry runtime is not ready';
    }
    if (changed || !environment.ready) {
      this.options.onChange?.();
    }
  }

  private assertIdentity(environment: FoundryEnvironment): void {
    const expectedWorld = this.config.expectedWorldId ?? this.boundWorldId;
    if (typeof environment.world.id !== 'string' || !environment.world.id.trim()) {
      throw new SessionError(
        'world_unidentified',
        `Provider for target ${this.config.id} did not identify a world`,
      );
    }
    if (expectedWorld && environment.world.id !== expectedWorld) {
      throw new SessionError(
        'world_mismatch',
        `Target ${this.config.id} expected world ${expectedWorld}, received ${environment.world.id}`,
      );
    }
    const expectedOrigin = this.config.expectedOrigin ?? this.boundOrigin;
    if (
      expectedOrigin &&
      (!environment.origin || new URL(environment.origin).origin !== new URL(expectedOrigin).origin)
    ) {
      throw new SessionError(
        'origin_mismatch',
        `Target ${this.config.id} is connected to an unexpected Foundry origin`,
      );
    }
    this.boundWorldId = environment.world.id;
    this.boundOrigin = environment.origin;
  }

  private async establish(mode: 'connect' | 'refresh'): Promise<void> {
    if (this.closed) {
      throw new SessionError('session_closed', `Target ${this.config.id} is closed`);
    }
    const generation = this.advanceGeneration();
    this.currentState = 'connecting';
    this.error = undefined;
    this.integrationError = undefined;
    this.options.onChange?.();
    try {
      await this.integrations.close();
      // close() may run while optional worker cleanup is pending. Its first
      // disconnect must not be followed by a newly started authentication.
      if (this.closed) {
        throw new SessionError('session_closed', `Target ${this.config.id} is closed`);
      }
      if (generation !== this.generation) {
        throw new SessionError('session_changed', 'The connection attempt was superseded');
      }
      if (mode === 'connect') {
        await this.provider.connect();
      } else {
        if (!this.provider.isConnected()) {
          throw new SessionError('target_unavailable', `Target ${this.config.id} is disconnected`);
        }
        await this.provider.refreshWorldData();
      }
      const providerGeneration = this.provider.getGeneration();
      const environment = await this.provider.inspect();
      this.requireCurrent(generation, providerGeneration, false);
      this.assertIdentity(environment);
      this.environment = environment;
      this.providerGeneration = providerGeneration;
      this.integrations = this.createIntegrations();
      if (this.config.integrationsEnabled) {
        try {
          await this.integrations.reconcile(
            { ...environment, runtimeAvailable: this.provider.capabilities.has('runtime.execute') },
            generation,
          );
        } catch (error) {
          // Optional Python integrations must not take the core connection down.
          this.integrationError = this.publicError(error);
          await this.integrations.close();
        }
      }
      this.requireCurrent(generation, providerGeneration, false);
      this.currentState = environment.ready ? 'ready' : 'offline';
      if (!environment.ready) {
        this.error = 'Foundry runtime is not ready';
      }
      this.options.onChange?.();
    } catch (error) {
      if (!this.closed) {
        this.currentState = 'error';
        this.error = this.publicError(error);
        this.options.onChange?.();
      }
      throw error;
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.lifecycle.then(() =>
      withOperationContext(undefined, async () => {
        if (this.closed) {
          throw new SessionError('session_closed', `Target ${this.config.id} is closed`);
        }
        this.lifecycleBusy = true;
        try {
          return await operation();
        } finally {
          this.lifecycleBusy = false;
        }
      }),
    );
    this.lifecycle = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  private startMonitor(): void {
    const interval = this.options.monitorIntervalMs ?? 1000;
    if (this.monitor || this.closed || interval <= 0) {
      return;
    }
    this.monitor = setInterval(() => {
      if (this.closed || this.lifecycleBusy || this.currentState === 'error') {
        return;
      }
      if (!this.provider.isConnected()) {
        if (this.currentState === 'ready' || this.currentState === 'connecting') {
          this.advanceGeneration();
          this.currentState = 'offline';
          this.error = 'Provider disconnected';
          void this.integrations.close().catch(() => {});
          this.options.onChange?.();
        }
        return;
      }
      if (
        this.provider.getGeneration() !== this.providerGeneration ||
        this.currentState === 'offline'
      ) {
        void this.refresh().catch(() => {});
      }
    }, interval);
    this.monitor.unref();
  }

  private publicError(error: unknown): string {
    let message = error instanceof Error ? error.message : 'Unknown target error';
    const provider = this.config.provider;
    const candidates =
      provider.kind === 'composite' ? [provider.core, provider.execution] : [provider];
    for (const config of candidates) {
      for (const key of ['password', 'apiKey'] as const) {
        if (key in config) {
          const value = Reflect.get(config, key);
          if (typeof value === 'string' && value.length > 0) {
            message = message.split(value).join('[redacted]');
          }
        }
      }
    }
    return message;
  }
}
