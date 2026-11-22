import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { z } from 'zod';
import type { DiceRoll } from '../foundry/types.js';
import { applyDocumentBroadcast, parseDocumentBroadcast } from '../foundry/world-cache.js';
import { DocumentProvider } from './document-provider.js';
import { ProviderError } from './errors.js';
import { assertOperationCurrent, trackOperation } from './operation-context.js';
import { parseSnapshot, SNAPSHOT_SCRIPT } from './snapshot.js';
import type { FoundryEnvironment, ProviderKind, RestApiProviderConfig } from './types.js';

const EnvelopeSchema = z.object({
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

/** ThreeHats relay backend. The remote client must explicitly allow execute-js. */
export class RestApiProvider extends DocumentProvider {
  private readonly relay: AxiosInstance;
  private readonly relayConfig: RestApiProviderConfig;
  private readonly pending = new Set<AbortController>();
  private boundIdentity: { worldId: string; origin: string } | undefined;
  private runtimeReady = false;

  constructor(config: RestApiProviderConfig) {
    super({
      baseUrl: config.relayUrl,
      ...(config.timeout === undefined ? {} : { timeout: config.timeout }),
      writeEnabled: config.writeEnabled ?? false,
    });
    if (!config.apiKey || !config.clientId) {
      throw new Error('REST API provider requires apiKey and clientId');
    }
    const path = config.executeJsPath ?? '/execute-js';
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
      throw new Error('executeJsPath must be a relative absolute path on the configured relay');
    }
    this.relayConfig = config;
    this.relay = axios.create({
      baseURL: config.relayUrl,
      timeout: this.config.timeout ?? 10000,
      headers: { 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
      maxRedirects: 0,
      maxContentLength: 50 * 1024 * 1024,
      maxBodyLength: 50 * 1024 * 1024,
    });
  }

  override get kind(): ProviderKind {
    return 'rest-api';
  }
  override get capabilities(): ReadonlySet<string> {
    return new Set([
      'core.read',
      'core.cache',
      'runtime.execute',
      ...(this.config.writeEnabled ? ['core.write'] : []),
    ]);
  }
  override isConnected(): boolean {
    return this._isConnected;
  }

  override async connect(): Promise<void> {
    assertOperationCurrent();
    const epoch = ++this.generation;
    this._isConnected = false;
    this.boundIdentity = undefined;
    this.worldData = null;
    try {
      await this.readSnapshot();
      assertOperationCurrent();
      if (epoch !== this.generation) {
        throw new ProviderError('session_changed', 'The connection changed while loading the world');
      }
      this._isConnected = true;
    } catch (error) {
      if (epoch === this.generation) {
        this.worldData = null;
        this.runtimeReady = false;
      }
      throw error;
    }
  }

  override async disconnect(): Promise<void> {
    for (const request of this.pending) {
      request.abort();
    }
    this.pending.clear();
    this.boundIdentity = undefined;
    this.runtimeReady = false;
    await super.disconnect();
  }

  private async readSnapshot(): Promise<void> {
    const epoch = this.generation;
    const result = await this.request(SNAPSHOT_SCRIPT, {}, true);
    // Session refresh can replace the snapshot without changing the transport
    // epoch. An earlier automatic refresh must not overwrite that new snapshot.
    assertOperationCurrent();
    let parsed: ReturnType<typeof parseSnapshot>;
    try {
      parsed = parseSnapshot(result);
    } catch (error) {
      throw new ProviderError('invalid_response', 'The relay returned an invalid world snapshot', {
        cause: error,
      });
    }
    const worldId = parsed.snapshot.world.id;
    if (typeof worldId !== 'string' || !worldId.trim() || !parsed.ready) {
      throw new ProviderError('invalid_response', 'The runtime did not identify a ready world');
    }
    if (this.relayConfig.expectedWorldId && this.relayConfig.expectedWorldId !== worldId) {
      throw new ProviderError(
        'identity_mismatch',
        'The paired client is running a different world',
      );
    }
    if (
      this.relayConfig.expectedOrigin &&
      new URL(this.relayConfig.expectedOrigin).origin !== parsed.origin
    ) {
      throw new ProviderError(
        'identity_mismatch',
        'The paired client belongs to a different Foundry origin',
      );
    }
    if (epoch !== this.generation) {
      throw new ProviderError('session_changed', 'Discarded a snapshot from an expired connection');
    }
    this.worldData = parsed.snapshot;
    this.worldDataStale = false;
    this.runtimeReady = parsed.ready;
    this.boundIdentity = { worldId, origin: parsed.origin };
  }

  override async refreshWorldData(): Promise<void> {
    if (!this.isConnected()) {
      throw new ProviderError('target_offline', 'The relay target is disconnected');
    }
    await this.readSnapshot();
  }

  override async inspect(): Promise<FoundryEnvironment> {
    const environment = await super.inspect();
    return {
      ...environment,
      ready: this.runtimeReady && !this.worldDataStale,
      origin: this.boundIdentity?.origin ?? '',
    };
  }

  override async testConnection(): Promise<boolean> {
    await this.refreshWorldData();
    return true;
  }

  override async execute(
    script: string,
    args: Record<string, unknown>,
    options: { readOnly: boolean },
  ): Promise<unknown> {
    assertOperationCurrent();
    if (!this.isConnected()) {
      throw new ProviderError('target_offline', 'The relay target is disconnected');
    }
    if (!options.readOnly) {
      this.assertWriteable();
      // A binding may mutate documents and then fail or lose its response.
      // Invalidate before dispatch so every outcome requires a fresh snapshot.
      this.worldDataStale = true;
    }
    const epoch = this.generation;
    try {
      return await this.request(script, args, options.readOnly);
    } finally {
      // A refresh may finish while the remote write is still running. Its
      // snapshot cannot establish the final state of that write. An expired
      // request must not invalidate a replacement generation's snapshot.
      if (!options.readOnly && epoch === this.generation) {
        this.worldDataStale = true;
      }
    }
  }

  protected override assertWriteable(): void {
    if (!this.config.writeEnabled) {
      throw new ProviderError('writes_disabled', 'Write operations are disabled for this target');
    }
    if (!this.isConnected()) {
      throw new ProviderError('target_offline', 'The relay target is disconnected');
    }
  }

  private async request(
    script: string,
    args: Record<string, unknown>,
    readOnly: boolean,
  ): Promise<unknown> {
    // This check is outside the transport catch: a cancelled operation has not
    // sent anything and must not be misreported as a new network failure.
    assertOperationCurrent();
    const epoch = this.generation;
    const identity = this.boundIdentity;
    const guard = identity
      ? `
if (typeof game === 'undefined' || !game.ready || game.world.id !== ${JSON.stringify(identity.worldId)} || (globalThis.location?.origin ?? '') !== ${JSON.stringify(identity.origin)}) {
  return { __foundryMcpError: 'identity_mismatch' };
}`
      : '';
    // JSON encoding preserves argument boundaries, including quotes and line breaks.
    const body = {
      clientId: this.relayConfig.clientId,
      script: `const args = ${JSON.stringify(args)};\n${guard}\nreturn await (async () => {\n${script}\n})();`,
    };
    const controller = new AbortController();
    assertOperationCurrent();
    this.pending.add(controller);
    try {
      const response = await trackOperation(
        this.relay.post(this.relayConfig.executeJsPath ?? '/execute-js', body, {
          params: { clientId: this.relayConfig.clientId },
          signal: controller.signal,
        }),
      );
      if (epoch !== this.generation) {
        throw new ProviderError(
          readOnly ? 'session_changed' : 'outcome_unknown',
          'The connection changed while the operation was in flight',
        );
      }
      const parsed = EnvelopeSchema.safeParse(response.data);
      if (!parsed.success || (!Object.hasOwn(parsed.data, 'result') && parsed.data.success)) {
        throw new ProviderError(
          readOnly ? 'invalid_response' : 'outcome_unknown',
          'The relay returned an invalid execution envelope',
        );
      }
      if (!parsed.data.success) {
        const detail =
          typeof parsed.data.error === 'string' ? parsed.data.error : 'Remote execution failed';
        throw new ProviderError(readOnly ? 'execution_rejected' : 'outcome_unknown', detail);
      }
      const result = parsed.data.result;
      if (
        typeof result === 'object' &&
        result !== null &&
        Reflect.get(result, '__foundryMcpError') === 'identity_mismatch'
      ) {
        // A confirmed identity change invalidates the entire bound connection.
        // Keep it offline until an explicit reconnect binds a fresh snapshot.
        this.generation++;
        this._isConnected = false;
        this.runtimeReady = false;
        this.worldDataStale = this.worldData !== null;
        for (const pending of this.pending) {
          if (pending !== controller) {
            pending.abort();
          }
        }
        throw new ProviderError(
          'identity_mismatch',
          'The paired client changed world or origin; reconnect the target explicitly',
        );
      }
      return result;
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status !== undefined && [400, 401, 403, 404, 422].includes(status)) {
        throw new ProviderError(
          'execution_rejected',
          `The relay rejected the request (HTTP ${status})`,
        );
      }
      // Aborted work from an expired connection cannot take a replacement
      // connection offline after the caller explicitly reconnects.
      if (epoch === this.generation) {
        if (this._isConnected) {
          this.generation++;
        }
        this._isConnected = false;
        this.worldDataStale = this.worldData !== null;
      }
      // No retry: a lost response does not establish that a mutation was unapplied.
      throw new ProviderError(
        readOnly ? 'target_offline' : 'outcome_unknown',
        readOnly
          ? 'The relay request failed'
          : 'The write outcome is unknown; inspect the world before retrying',
      );
    } finally {
      this.pending.delete(controller);
    }
  }

  protected override async modifyDocument(
    type: string,
    action: 'create' | 'update' | 'delete',
    operation: Record<string, unknown>,
  ): Promise<unknown[]> {
    this.assertWriteable();
    const epoch = this.generation;
    const snapshot = this.worldData;
    const result = await this.execute(
      `
const parent = args.operation.parentUuid ? await fromUuid(args.operation.parentUuid) : null;
if (args.operation.parentUuid && !parent) throw new Error('Parent document not found');
const cls = CONFIG[args.type]?.documentClass;
if (!cls) throw new Error('Unsupported document type');
const options = { diff: true, recursive: true };
let documents;
if (parent) {
  if (args.action === 'create') documents = await parent.createEmbeddedDocuments(args.type, args.operation.data, options);
  else if (args.action === 'update') documents = await parent.updateEmbeddedDocuments(args.type, args.operation.updates, options);
  else documents = await parent.deleteEmbeddedDocuments(args.type, args.operation.ids, options);
} else {
  if (args.action === 'create') documents = await cls.createDocuments(args.operation.data, options);
  else if (args.action === 'update') documents = await cls.updateDocuments(args.operation.updates, options);
  else documents = await cls.deleteDocuments(args.operation.ids, options);
}
return Array.from(documents).map(document => args.action === 'delete' ? document.id : document.toObject(false));
`,
      { type, action, operation },
      { readOnly: false },
    );
    try {
      assertOperationCurrent();
      if (epoch !== this.generation) {
        throw new ProviderError('session_changed', 'The mutation belongs to an expired connection');
      }
    } catch (error) {
      throw new ProviderError(
        'outcome_unknown',
        'Discarded a mutation result from an expired operation; inspect the world before retrying',
        { cause: error },
      );
    }
    if (!Array.isArray(result)) {
      throw new ProviderError(
        'outcome_unknown',
        'The mutation completed without a valid document result',
      );
    }
    if (snapshot && this.worldData === snapshot) {
      const broadcast = parseDocumentBroadcast({ type, action, operation, result });
      if (broadcast) {
        applyDocumentBroadcast(snapshot, broadcast);
      }
    }
    return result;
  }

  override async rollDice(formula: string, reason?: string): Promise<DiceRoll> {
    // Match the existing portable contract; runtime Roll evaluates the actual dice.
    if (typeof formula !== 'string' || formula.length > 100 || !/^[0-9d\s+\-()]+$/.test(formula)) {
      throw new Error('Invalid dice formula');
    }
    const result = await this.execute(
      'const roll = await new Roll(args.formula).evaluate(); return { total: roll.total, breakdown: roll.result };',
      { formula },
      { readOnly: true },
    );
    const roll = z.object({ total: z.number(), breakdown: z.string() }).parse(result);
    return {
      formula,
      ...roll,
      source: 'server',
      timestamp: new Date().toISOString(),
      ...(reason ? { reason } : {}),
    };
  }

  override async get<T = unknown>(
    _url: string,
    _config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    throw new ProviderError(
      'unsupported_operation',
      'The ThreeHats relay does not implement the historical /api/diagnostics contract',
    );
  }
}
