import { parseFoundryGeneration } from '../integrations/types.js';
import { ProviderError } from './errors.js';
import { RestApiProvider } from './rest-api.js';
import { SocketIOProvider } from './socketio.js';
import type { CompositeProviderConfig, FoundryEnvironment, ProviderKind } from './types.js';

/** Explicit composition: native core operations and relay runtime operations, with no failover. */
export class CompositeProvider extends SocketIOProvider {
  private readonly execution: RestApiProvider;

  constructor(config: CompositeProviderConfig) {
    super(config.core);
    this.execution = new RestApiProvider(config.execution);
  }

  override get kind(): ProviderKind {
    return 'composite';
  }
  override get capabilities(): ReadonlySet<string> {
    return new Set([
      ...super.capabilities,
      'runtime.execute',
      ...(this.execution.capabilities.has('runtime.named') ? ['runtime.named'] : []),
    ]);
  }
  override getGeneration(): number {
    return super.getGeneration() + this.execution.getGeneration();
  }
  override isConnected(): boolean {
    return super.isConnected() && this.execution.isConnected();
  }
  override isWorldDataStale(): boolean {
    return super.isWorldDataStale() || this.execution.isWorldDataStale();
  }

  override async connect(): Promise<void> {
    const results = await Promise.allSettled([super.connect(), this.execution.connect()]);
    try {
      const failed = results.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') {
        throw failed.reason;
      }
      await this.inspect();
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  override async disconnect(): Promise<void> {
    await Promise.allSettled([super.disconnect(), this.execution.disconnect()]);
  }

  override async refreshWorldData(): Promise<void> {
    const results = await Promise.allSettled([
      super.refreshWorldData(),
      this.execution.refreshWorldData(),
    ]);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') {
      throw failed.reason;
    }
    await this.inspect();
  }

  override async inspect(): Promise<FoundryEnvironment> {
    const [core, runtime] = await Promise.all([super.inspect(), this.execution.inspect()]);
    const coreGeneration = parseFoundryGeneration(core.foundryVersion);
    const runtimeGeneration = parseFoundryGeneration(runtime.foundryVersion);
    if (
      core.world.id !== runtime.world.id ||
      core.origin !== runtime.origin ||
      core.system.id !== runtime.system.id ||
      core.system.version !== runtime.system.version ||
      // A generation-only release and a full build can identify the same generation.
      // Unknown legacy releases keep their existing behavior, without inventing an identity.
      (coreGeneration !== undefined &&
        runtimeGeneration !== undefined &&
        coreGeneration !== runtimeGeneration)
    ) {
      throw new ProviderError(
        'identity_mismatch',
        'Socket.IO and relay must identify the same Foundry origin, world, system and known generation',
      );
    }
    return {
      ...runtime,
      ready: core.ready && runtime.ready,
      ...(core.userId ? { coreUserId: core.userId } : {}),
    };
  }

  override async execute(
    script: string,
    args: Record<string, unknown>,
    options: { readOnly: boolean; operation?: string },
  ): Promise<unknown> {
    if (!this.isConnected()) {
      throw new ProviderError('target_offline', 'The composed target is disconnected');
    }
    if (super.isWorldDataStale()) {
      throw new ProviderError(
        'session_changed',
        'Refresh the target after its native connection changed',
      );
    }
    // A runtime binding never falls back to native document CRUD.
    return this.execution.execute(script, args, options);
  }

  override async testConnection(): Promise<boolean> {
    await this.refreshWorldData();
    return true;
  }
}
