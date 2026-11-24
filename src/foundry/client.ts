/**
 * FoundryVTT client for API communication via Socket.IO
 *
 * Connects to FoundryVTT using the proven 4-step authentication flow,
 * caches worldData in memory, and serves all queries from the snapshot.
 */

import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { io, type Socket } from 'socket.io-client';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { authenticateFoundry, sessionSocketOptions, socketOrigin } from './auth.js';
import { type Capability, sourceOrder } from './capabilities.js';
import { evaluateDiceFormula } from './dice-formula.js';
import {
  abilityModifier,
  characterClassLevel,
  flatArmorClass,
  proficiencyBonus,
} from './dnd5e-derived.js';
import {
  decodeCursor,
  mapRestActor,
  mapRestActorSearch,
  mapRestCompendiumSearch,
  mapRestDiceRoll,
  mapRestItemSearch,
  mapRestScene,
  mapRestWorld,
  RestRequestError,
  RestShapeError,
} from './rest-mappers.js';
import { probeRestModule, RestKeyRejectedError, RestProbeResponseError } from './rest-probe.js';
import { resolveTransportPlan, type TransportMode } from './transport.js';
import type {
  ActorAttributeUpdateResult,
  ActorItemCreateSource,
  ActorSearchResult,
  CompendiumSearchResult,
  DerivedActorField,
  DiceRoll,
  DocumentVisibility,
  FoundryActor,
  FoundryItem,
  FoundryScene,
  FoundryWorld,
  ItemSearchResult,
  JournalPageCreateSource,
  WorldActor,
  WorldCombat,
  WorldData,
  WorldEffect,
  WorldItem,
  WorldJournal,
  WorldMessage,
  WorldScene,
  WorldUser,
} from './types.js';
import { VISIBILITY_LEVELS } from './types.js';
import {
  applyDocumentBroadcast,
  applyUserActivity,
  type DocumentBroadcast,
  parseDocumentBroadcast,
  parseDocumentBroadcastBatch,
  parseUserActivity,
} from './world-cache.js';
import { searchWorldDocuments, type WorldSearchResults } from './world-search.js';

// Re-exported so existing importers of `client.js` keep working (#255 moved it).
export { probeRestModule };

/** FoundryVTT document IDs are 16-character alphanumeric strings. */
const FOUNDRY_ID_PATTERN = /^[a-zA-Z0-9]{16}$/;

/**
 * Characters a dice formula may contain. A cheap sanity gate, not a grammar:
 * it rejects Foundry modifier syntax (`4d6kh3`), attribute references
 * (`1d20+STR`) and arithmetic this server never forwards (`*`, `/`), while
 * still allowing parentheses through to FoundryVTT's own `Roll` engine on the
 * REST transport. See {@link FoundryClient.rollDice}.
 */
const DICE_FORMULA_ALPHABET = /^[0-9d\s+\-()]+$/;

/** Single-character form of {@link DICE_FORMULA_ALPHABET}, for locating a violation. */
const DICE_FORMULA_CHARACTER = /[0-9d\s+\-()]/;

/** Upper bound on formula length, common to both transports. */
const MAX_DICE_FORMULA_LENGTH = 100;

/**
 * Builds the REST-path rejection for a formula outside the dice alphabet.
 *
 * The local parser cannot be borrowed for this: it rejects parentheses, which
 * REST *does* support, so for `(1d20+5)*2` it would name the wrong problem.
 * This scans for the first character the alphabet does not admit and reports
 * it by name and position, so the REST path is as specific about what it
 * refused as the local one (#219).
 */
function alphabetViolation(formula: string): Error {
  if (formula === '') {
    return new Error('Invalid dice formula: the formula is empty.');
  }
  const index = [...formula].findIndex((char) => !DICE_FORMULA_CHARACTER.test(char));
  if (index === -1) {
    return new Error(`Invalid dice formula: ${formula}`);
  }
  return new Error(
    `Invalid dice formula "${formula}": unexpected "${formula[index]}" at position ${index}. ` +
      'Supported syntax: dice terms (NdS, or dS for a single die) and whole numbers, joined by ' +
      '+ or -, optionally grouped in parentheses.',
  );
}

/**
 * True when a rejected request carries an HTTP response — FoundryVTT answered,
 * whatever the status. A rejection without one is a transport failure
 * (connection refused or reset, DNS, timeout): the server is not reachable.
 *
 * Read reflectively rather than cast, so a non-axios rejection cannot be
 * mistaken for a reply.
 */
function hasHttpResponse(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const response = Reflect.get(error, 'response');
  return response !== undefined && response !== null;
}

/**
 * HTTP status of a rejected REST request, read reflectively from the error or,
 * for an error that wraps one (the connect probe), from its `cause`.
 */
function restStatusOf(error: unknown): number | undefined {
  for (const candidate of [error, causeOf(error)]) {
    const response = responseOf(candidate);
    const status: unknown = response === undefined ? undefined : Reflect.get(response, 'status');
    if (typeof status === 'number') {
      return status;
    }
  }
  return undefined;
}

function causeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, 'cause') : undefined;
}

function responseOf(error: unknown): object | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const response: unknown = Reflect.get(error, 'response');
  return typeof response === 'object' && response !== null ? response : undefined;
}

/**
 * The bridge's own one-line explanation in an error body (`{ message }`), if
 * any: e.g. "Failed to communicate with FoundryVTT server" for the 500 it
 * answers when no GM browser client runs the module.
 */
function restBodyMessage(error: unknown): string | undefined {
  for (const candidate of [error, causeOf(error)]) {
    const response = responseOf(candidate);
    const data: unknown = response === undefined ? undefined : Reflect.get(response, 'data');
    if (typeof data === 'object' && data !== null) {
      const message: unknown = Reflect.get(data, 'message');
      if (typeof message === 'string' && message.trim() !== '') {
        return message.replace(/\s+/g, ' ').trim().slice(0, 200);
      }
    }
  }
  return undefined;
}

/**
 * What a failed REST request says about the bridge:
 * - `unreachable`: no HTTP response (refused, reset, DNS, client timeout);
 * - `server-error`: an HTTP 5xx — the bridge answered but could not serve the
 *   request, typically because no GM browser client runs the module and its
 *   socket request timed out;
 * - `rejected`: an HTTP 4xx, or the module's `success: false` — this request
 *   was refused; others may work;
 * - `invalid-response`: a 2xx the MCP cannot read (an incompatible bridge).
 */
function classifyRestFailure(error: unknown): Exclude<RestState, 'ok'> {
  const status = restStatusOf(error);
  if (status !== undefined) {
    return status >= 500 ? 'server-error' : 'rejected';
  }
  if (
    error instanceof RestShapeError ||
    error instanceof RestProbeResponseError ||
    error instanceof z.ZodError
  ) {
    return 'invalid-response';
  }
  if (error instanceof RestRequestError) {
    return 'rejected';
  }
  return 'unreachable';
}

/**
 * Spacing between sibling `sort` values, mirroring Foundry's
 * `CONST.SORT_INTEGER_DENSITY`. Leaving every sibling at the default `0` makes
 * ordering depend on incidental collection insertion order, and gives Foundry
 * no gap to slot a UI-created sibling into later.
 */
const SORT_INTEGER_DENSITY = 100000;

/**
 * Accepts the two parent-UUID forms a token's actor can take:
 *  - `Actor.<id>` — a world-linked actor (`actorLink: true`)
 *  - `Scene.<sid>.Token.<tid>.Actor.<aid>` — an unlinked token's synthetic actor
 */
const TOKEN_ACTOR_UUID_PATTERN =
  /^(Actor\.[a-zA-Z0-9]{16}|Scene\.[a-zA-Z0-9]{16}\.Token\.[a-zA-Z0-9]{16}\.Actor\.[a-zA-Z0-9]{16})$/;

/**
 * Loggable summary of why a REST call failed (#254).
 *
 * Reads only the HTTP status and the error code, structurally rather than via
 * `axios.isAxiosError`, so nothing else on the error — in particular
 * `config.headers`, which carries the `x-api-key` — reaches the log.
 */
function describeRestFailure(error: unknown): {
  reason: string;
  status?: number;
  code?: string;
} {
  if (error instanceof z.ZodError || error instanceof RestShapeError) {
    return { reason: 'response body failed schema validation' };
  }
  if (typeof error !== 'object' || error === null) {
    return { reason: 'request failed' };
  }

  const summary: { reason: string; status?: number; code?: string } = {
    reason: 'request failed',
  };
  const response: unknown = 'response' in error ? error.response : undefined;
  if (typeof response === 'object' && response !== null && 'status' in response) {
    const status: unknown = response.status;
    if (typeof status === 'number') {
      summary.status = status;
      summary.reason = 'HTTP error response';
    }
  }
  const code: unknown = 'code' in error ? error.code : undefined;
  if (typeof code === 'string') {
    summary.code = code;
  }
  return summary;
}

/**
 * Minimal Zod schema for the WorldData Socket.IO payload.
 * Validates the required top-level array fields; extra fields pass through.
 */
const WorldDataSchema = z.object({
  userId: z.string(),
  actors: z.array(z.unknown()),
  scenes: z.array(z.unknown()),
  items: z.array(z.unknown()),
  journal: z.array(z.unknown()),
  messages: z.array(z.unknown()),
  combats: z.array(z.unknown()),
  users: z.array(z.unknown()),
  activeUsers: z.array(z.string()),
  macros: z.array(z.unknown()),
  playlists: z.array(z.unknown()),
  tables: z.array(z.unknown()),
  folders: z.array(z.unknown()),
});

export interface FoundryClientConfig {
  baseUrl: string;
  apiKey?: string;
  /**
   * REST bridge server (FOUNDRY_REST_URL). With `apiKey` and Socket.IO
   * credentials it enables dual mode; see `transport.ts`.
   */
  restUrl?: string;
  username?: string;
  password?: string;
  userId?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  socketPath?: string;
  /** Opt-in gate for game-state mutations (FOUNDRY_WRITE_ENABLED). Default false. */
  writeEnabled?: boolean;
}

/** Outcome of the last REST request; see {@link classifyRestFailure}. */
export type RestState = 'ok' | 'unreachable' | 'server-error' | 'rejected' | 'invalid-response';

/** Dual mode: bridge calls skipped until a cooldown ends. */
export interface RestPause {
  /** One capability (after its 5xx), or `bridge` for every call. */
  scope: Capability | 'bridge';
  /** The failure that started the pause. */
  error: string;
  retryInSeconds: number;
}

/** Both connections as `get_health_status` reports them. */
export interface ConnectionReport {
  mode: TransportMode;
  socket: { used: boolean; connected: boolean };
  rest: {
    configured: boolean;
    /** Origin and path of the REST base URL; credentials in it are never shown. */
    baseUrl?: string;
    /**
     * The last REST request got an HTTP answer (any state but `unreachable`).
     * Undefined until the first REST request (or the connect probe) completes.
     */
    reachable?: boolean;
    /** Outcome of the last REST request; undefined before the first. */
    state?: RestState;
    /** Why the last REST request failed; absent when it succeeded. */
    lastError?: string;
    /** Dual mode: pauses still running; absent when none. */
    paused?: RestPause[];
  };
}

/**
 * How long dual mode skips the bridge after a failure that would cost the
 * same wait again: the whole bridge after a transport failure (or a 5xx on the
 * connect probe), one capability after its 5xx. A bridge with no GM client
 * answers 500 only after its own REQUEST_TIMEOUT (5 s by default), so without
 * the pause every call would wait that long before falling back.
 */
const REST_RETRY_AFTER_MS = 30_000;

/** One FoundryVTT `modifyDocument` response, as far as the write path reads it. */
const DocumentSocketResponseSchema = z.object({
  /** Created/updated data objects, or deleted ids, on success. */
  result: z.array(z.unknown()).optional(),
  /** Present when the server rejects the operation. */
  error: z.object({ message: z.string().optional() }).passthrough().nullish(),
  /** v14: true for a response describing a server-side side effect, not the request itself. */
  sideEffect: z.boolean().optional(),
});
type DocumentSocketResponse = z.infer<typeof DocumentSocketResponseSchema>;

/**
 * The `modifyDocument` acknowledgement. A single response when the write had no
 * side effects (v13 and v14); from v14, `{ results: [...] }` — the side-effect
 * responses plus the primary one — when it did (#232).
 */
const ModifyDocumentAckSchema = z.union([
  z.object({ results: z.array(DocumentSocketResponseSchema) }),
  DocumentSocketResponseSchema,
]);

export interface SearchActorsParams {
  query?: string;
  type?: string;
  limit?: number;
}

export interface SearchItemsParams {
  query?: string;
  type?: string;
  rarity?: string;
  limit?: number;
}

export interface CompendiumSearchParams {
  query?: string;
  packType?: string;
  itemType?: string;
  spellLevel?: number;
  source?: string;
  compendiumId?: string;
  limit?: number;
  /** Opaque pagination cursor from a prior result's `nextCursor`. */
  cursor?: string;
}

/**
 * Shallow attribute patch for {@link FoundryClient.updateActorAttribute} (#143).
 *
 * Keys are dot-paths into the actor's `system` object (e.g.
 * `attributes.hp.value`, `currency.gp`, `spells.spell1.value`,
 * `attributes.exhaustion`). Values are the scalar to set at that path.
 */
export type AttributePatch = Record<string, number | string | boolean>;

export class FoundryClient {
  private http: AxiosInstance;
  private socket: Socket | null = null;
  private config: FoundryClientConfig;
  private _isConnected = false;
  private worldData: WorldData | null = null;
  /** Set when the socket drops with a cache still loaded (#217). */
  private worldDataStale = false;
  /**
   * Last observed outcome of a REST request: false once one failed to reach
   * the REST server at all (#217). Unused in Socket.IO mode.
   */
  private restLinkLive = true;
  private readonly mode: TransportMode;
  private readonly transportWarnings: readonly string[];
  /** HTTP client for the REST bridge (dual) or REST server (REST-only); null in Socket.IO mode. */
  private rest: AxiosInstance | null = null;
  private restBaseUrl: string | undefined;
  /** Outcome of the last REST request in any mode; undefined before the first. */
  private restState: RestState | undefined;
  private restLastError: string | undefined;
  /** Dual mode: skip every bridge call until this time (transport failure, probe 5xx). */
  private restRetryAfter = 0;
  private restPauseError: string | undefined;
  /** Dual mode: skip one capability's bridge calls until `until`, after its 5xx. */
  private readonly restCapabilityPauses = new Map<Capability, { until: number; error: string }>();
  /** Dual mode: capabilities whose bridge failure was already logged since the last success. */
  private readonly restFailuresLogged = new Set<string>();

  constructor(config: FoundryClientConfig) {
    if (!config.baseUrl || config.baseUrl.trim() === '') {
      throw new Error('baseUrl is required and cannot be empty');
    }

    try {
      new URL(config.baseUrl);
    } catch {
      throw new Error(`Invalid baseUrl: ${config.baseUrl}`);
    }

    this.config = {
      timeout: 10000,
      retryAttempts: 3,
      retryDelay: 1000,
      socketPath: '/socket.io/',
      ...config,
    };

    this.http = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FoundryMCP/0.2.0',
      },
      maxRedirects: 3,
      maxContentLength: 50 * 1024 * 1024,
      maxBodyLength: 50 * 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const plan = resolveTransportPlan({
      url: this.config.baseUrl,
      apiKey: this.config.apiKey,
      restUrl: this.config.restUrl,
      username: this.config.username,
      userId: this.config.userId,
      password: this.config.password,
    });
    this.mode = plan.mode;
    this.transportWarnings = plan.warnings;

    if (plan.restBaseUrl !== undefined) {
      try {
        new URL(plan.restBaseUrl);
      } catch {
        throw new Error(`Invalid restUrl: ${plan.restBaseUrl}`);
      }
      this.restBaseUrl = plan.restBaseUrl;
      this.rest = this.createRestClient(plan.restBaseUrl);
    }

    const label = { socket: 'Socket.IO', dual: 'Socket.IO + REST bridge', rest: 'REST API' }[
      this.mode
    ];
    logger.info(`FoundryVTT client initialized (${label} mode)`);
  }

  /**
   * The REST HTTP client: sends the key, and records every outcome so that
   * liveness needs no extra I/O (#217). Only this client carries the key; the
   * Foundry HTTP client never does.
   */
  private createRestClient(baseURL: string): AxiosInstance {
    const rest = axios.create({
      baseURL,
      timeout: this.config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FoundryMCP/0.2.0',
      },
      maxRedirects: 3,
      maxContentLength: 50 * 1024 * 1024,
      maxBodyLength: 50 * 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    rest.interceptors.request.use((reqConfig) => {
      reqConfig.headers['x-api-key'] = this.config.apiKey;
      return reqConfig;
    });
    rest.interceptors.response.use(
      (response) => {
        this.restLinkLive = true;
        this.restState = 'ok';
        this.restLastError = undefined;
        return response;
      },
      (error: unknown) => {
        this.restLinkLive = hasHttpResponse(error);
        this.noteRestFailure(error);
        return Promise.reject(error);
      },
    );
    return rest;
  }

  /** Which connections this client uses; see `transport.ts`. */
  getTransportMode(): TransportMode {
    return this.mode;
  }

  /** Configuration problems found when choosing the transport, for logging once at startup. */
  getTransportWarnings(): readonly string[] {
    return this.transportWarnings;
  }

  /** Both connections, for `get_health_status`. Never does I/O. */
  getConnectionReport(): ConnectionReport {
    const socketUsed = this.mode !== 'rest';
    const report: ConnectionReport = {
      mode: this.mode,
      socket: { used: socketUsed, connected: socketUsed && this.isConnected() },
      rest: { configured: this.rest !== null },
    };
    if (this.rest !== null && this.restBaseUrl !== undefined) {
      const url = new URL(this.restBaseUrl);
      report.rest.baseUrl = `${url.origin}${url.pathname === '/' ? '' : url.pathname}`;
      if (this.restState !== undefined) {
        report.rest.reachable = this.restState !== 'unreachable';
        report.rest.state = this.restState;
      }
      if (this.restLastError !== undefined && this.restState !== 'ok') {
        report.rest.lastError = this.restLastError;
      }
      const paused = this.activeRestPauses();
      if (paused.length > 0) {
        report.rest.paused = paused;
      }
    }
    return report;
  }

  /** Pauses still running, whole bridge first. */
  private activeRestPauses(): RestPause[] {
    const now = Date.now();
    const seconds = (until: number) => Math.ceil((until - now) / 1000);
    const paused: RestPause[] = [];
    if (now < this.restRetryAfter) {
      paused.push({
        scope: 'bridge',
        error: this.restPauseError ?? 'request failed',
        retryInSeconds: seconds(this.restRetryAfter),
      });
    }
    for (const [capability, pause] of this.restCapabilityPauses) {
      if (now < pause.until) {
        paused.push({
          scope: capability,
          error: pause.error,
          retryInSeconds: seconds(pause.until),
        });
      }
    }
    return paused;
  }

  /** The pause that currently stops `capability` reaching the bridge, if any. */
  private restPauseFor(capability: Capability): RestPause | undefined {
    return this.activeRestPauses().find(
      (pause) => pause.scope === 'bridge' || pause.scope === capability,
    );
  }

  /**
   * Connects to FoundryVTT.
   * REST API mode: probes the module's authenticated /api/world route
   * (`probeRestModule`); connected only once it answers with a JSON object.
   * Socket.IO mode: authenticates and loads full worldData.
   */
  async connect(): Promise<void> {
    if (this.mode === 'rest' && this.rest) {
      const rest = this.rest;
      try {
        await probeRestModule((url) => rest.get(url));
        this._isConnected = true;
        this.recordRestSuccess();
        logger.info('Connected to FoundryVTT via REST API module');
      } catch (error) {
        this.recordRestFailure(error);
        logger.error('Failed to connect via REST API module:', error);
        throw error;
      }
      return;
    }

    const user = this.config.userId || this.config.username;
    if (!user || !this.config.password) {
      throw new Error(
        'Socket.IO mode requires username/userId and password. ' +
          'Set FOUNDRY_USERNAME + FOUNDRY_PASSWORD or FOUNDRY_USER_ID + FOUNDRY_PASSWORD.',
      );
    }

    const { session } = await authenticateFoundry(
      this.config.baseUrl,
      user,
      this.config.password,
      this.config.socketPath,
    );

    // Connect authenticated socket and load world data
    this.worldData = await this.connectAndLoadWorld(session);
    this.worldDataStale = false;
    this._isConnected = true;
    logger.info('Connected to FoundryVTT via Socket.IO', {
      actors: this.worldData.actors.length,
      scenes: this.worldData.scenes.length,
      items: this.worldData.items.length,
    });

    if (this.mode === 'dual') {
      await this.probeRestAugment();
    }
  }

  /**
   * Dual mode: checks the bridge once at connect. A failure is logged and
   * recorded, never thrown: Socket.IO is connected and every tool works
   * without the bridge, with the derived values labelled as before.
   */
  private async probeRestAugment(): Promise<void> {
    const rest = this.rest;
    if (!rest) {
      return;
    }
    try {
      await probeRestModule((url) => rest.get(url));
      this.recordRestSuccess();
      logger.info('Connected to the REST bridge', { url: this.getConnectionReport().rest.baseUrl });
    } catch (error) {
      this.recordRestFailure(error);
      logger.warn(
        'REST bridge unavailable — continuing on Socket.IO only; derived actor values, ' +
          'compendium search, logs and system health will report as unavailable',
        { ...describeRestFailure(error), error: this.restLastError },
      );
    }
  }

  private recordRestSuccess(capability?: Capability): void {
    this.restState = 'ok';
    this.restLastError = undefined;
    this.restRetryAfter = 0;
    this.restPauseError = undefined;
    if (capability !== undefined) {
      this.restCapabilityPauses.delete(capability);
    }
    this.restFailuresLogged.clear();
  }

  /** Records the state and summary of a failed REST request; returns the state. */
  private noteRestFailure(error: unknown): Exclude<RestState, 'ok'> {
    const state = classifyRestFailure(error);
    this.restState = state;
    this.restLastError = restErrorSummary(error);
    return state;
  }

  /**
   * Records a failed REST request and starts the pause it calls for (honoured
   * in dual mode, for {@link REST_RETRY_AFTER_MS}):
   * - no HTTP response: the whole bridge;
   * - a 5xx: the capability that got it, or the whole bridge when there is
   *   none (the connect probe, whose 5xx means no GM client serves any route);
   * - a 4xx or an unreadable answer: no pause — the bridge answered at once,
   *   so this call falls back and the next one asks again.
   * Outside dual mode only the state is recorded: REST-only mode retries in
   * `executeWithRetry` and nothing reads a pause, so reporting one would mislead.
   */
  private recordRestFailure(error: unknown, capability?: Capability): void {
    const state = this.noteRestFailure(error);
    if (this.mode !== 'dual') {
      return;
    }
    const until = Date.now() + REST_RETRY_AFTER_MS;
    const summary = this.restLastError ?? 'request failed';
    if (state === 'unreachable' || (state === 'server-error' && capability === undefined)) {
      this.restRetryAfter = until;
      this.restPauseError = summary;
    } else if (state === 'server-error' && capability !== undefined) {
      this.restCapabilityPauses.set(capability, { until, error: summary });
    }
  }

  /**
   * Dual mode: runs one REST call for `capability`. Returns undefined instead
   * of throwing when the bridge is paused, unreachable, answers an error or an
   * unknown shape, so the caller can fall back to its Socket.IO answer. The
   * first failure per capability is logged; later ones stay quiet until a
   * REST call succeeds again.
   */
  private async tryRest<T>(
    capability: Capability,
    call: (rest: AxiosInstance) => Promise<T>,
  ): Promise<T | undefined> {
    const rest = this.rest;
    if (!rest || this.restPauseFor(capability) !== undefined) {
      return undefined;
    }
    try {
      const result = await call(rest);
      this.recordRestSuccess(capability);
      return result;
    } catch (error) {
      this.recordRestFailure(error, capability);
      if (!this.restFailuresLogged.has(capability)) {
        this.restFailuresLogged.add(capability);
        logger.warn(`REST bridge failed for ${capability} — using the Socket.IO answer instead`, {
          ...describeRestFailure(error),
          error: this.restLastError,
        });
      }
      return undefined;
    }
  }

  /**
   * GET on the REST server, for callers with no Socket.IO alternative
   * (diagnostics). REST-only mode retries as before; dual mode makes one
   * attempt, honours the pause after a transport failure, and throws a
   * message naming the bridge; Socket.IO-only mode throws without any I/O.
   */
  async restGet(url: string): Promise<{ data: unknown }> {
    const rest = this.rest;
    if (!rest) {
      throw new Error(
        'The REST bridge is not configured: set FOUNDRY_API_KEY and FOUNDRY_REST_URL to enable it.',
      );
    }
    if (this.mode === 'rest') {
      return this.executeWithRetry(() => rest.get(url));
    }
    const capability = capabilityOfRestPath(url);
    const pause = this.restPauseFor(capability);
    if (pause !== undefined) {
      throw new Error(
        `The REST bridge is paused for ${pause.scope === 'bridge' ? 'all calls' : capability} ` +
          `after ${pause.error}; next attempt in ${pause.retryInSeconds} s.`,
      );
    }
    const response = await this.tryRest(capability, (client) => client.get(url));
    if (response === undefined) {
      throw new Error(
        `The REST bridge is unavailable (${this.restLastError ?? 'paused after a failed request'}).`,
      );
    }
    return response;
  }

  /**
   * Connects Socket.IO with an authenticated session and loads worldData.
   */
  private connectAndLoadWorld(session: string): Promise<WorldData> {
    // A previous socket must not outlive its replacement (see `detachSocket`).
    this.detachSocket();

    return new Promise((resolve, reject) => {
      // Origin + `path`, not the full baseUrl: a routePrefix in the URL would
      // be read as a Socket.IO namespace (#231).
      this.socket = io(
        socketOrigin(this.config.baseUrl),
        sessionSocketOptions(session, this.config.socketPath),
      );

      const cleanup = () => {
        this.socket?.off('session', onSession);
        this.socket?.off('connect_error', onConnectError);
      };

      const timeout = setTimeout(() => {
        cleanup();
        this.socket?.disconnect();
        reject(new Error('Timeout waiting for world data (15s)'));
      }, 15000);

      const onSession = (data: { userId?: string } | null) => {
        if (!data?.userId) {
          clearTimeout(timeout);
          cleanup();
          this.socket?.disconnect();
          return reject(new Error('Authentication failed — session event returned no userId'));
        }

        this.socket?.emit('world', (worldData: WorldData) => {
          clearTimeout(timeout);
          cleanup();
          const parsed = WorldDataSchema.safeParse(worldData);
          if (!parsed.success) {
            logger.warn('WorldData failed schema validation — proceeding with raw data', {
              issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
            });
          }
          // Keep the snapshot live from here on (#205). Attached only after a
          // successful handshake so the reject paths have no listener to leak.
          this.socket?.on('modifyDocument', this.onDocumentBroadcast);
          // v14 delivers a write that had side effects on this event instead (#232).
          this.socket?.on('modifyDocumentBatch', this.onDocumentBatchBroadcast);
          // Presence (#218): `activeUsers` is not a document collection, so it
          // only moves on this event.
          this.socket?.on('userActivity', this.onUserActivity);
          // Liveness (#217): a socket that drops on its own must stop reading
          // as connected, and one that socket.io reconnects must read as
          // connected again. Both are removed in `disconnect()`.
          this.socket?.on('connect', this.onSocketConnect);
          this.socket?.on('disconnect', this.onSocketDisconnect);
          resolve(worldData);
        });
      };

      const onConnectError = (err: Error) => {
        clearTimeout(timeout);
        cleanup();
        reject(new Error(`Socket.IO connection failed: ${err.message}`));
      };

      this.socket.on('session', onSession);
      this.socket.on('connect_error', onConnectError);
    });
  }

  /**
   * Applies a FoundryVTT `modifyDocument` broadcast to the cached world state (#205).
   *
   * Bound field rather than a method so the same reference can be passed to
   * `socket.off()` on teardown. Never throws: a malformed or unmodelled payload
   * leaves the cache untouched (and stale) rather than taking the connection down.
   */
  private onDocumentBroadcast = (payload: unknown): void => {
    const broadcast = parseDocumentBroadcast(payload);
    if (broadcast) {
      this.applyBroadcastToCache(broadcast);
    }
  };

  /**
   * Applies a FoundryVTT v14 `modifyDocumentBatch` broadcast (#232): a write
   * that had server-side side effects, delivered as `{ results: [...] }` with
   * one entry per side effect plus the primary change. Entries are applied in
   * order; like {@link onDocumentBroadcast}, this never throws.
   */
  private onDocumentBatchBroadcast = (payload: unknown): void => {
    for (const broadcast of parseDocumentBroadcastBatch(payload)) {
      this.applyBroadcastToCache(broadcast);
    }
  };

  /** Applies one validated broadcast to `worldData`, logging instead of throwing. */
  private applyBroadcastToCache(broadcast: DocumentBroadcast): void {
    if (!this.worldData) {
      return;
    }

    try {
      const applied = applyDocumentBroadcast(this.worldData, broadcast);
      logger.debug(
        applied
          ? `Applied ${broadcast.action} ${broadcast.type} broadcast to cached worldData`
          : `Ignored ${broadcast.action} ${broadcast.type} broadcast (not cached)`,
      );
    } catch (error) {
      logger.warn('Failed to apply document broadcast to cached worldData', {
        type: broadcast.type,
        action: broadcast.action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Applies a FoundryVTT `userActivity` broadcast to cached presence (#218).
   *
   * Foundry emits this on login, on logout, and on ordinary activity, and it is
   * the only signal that moves `worldData.activeUsers` — that field is a
   * top-level `WorldData` entry, not a document collection, so the
   * `modifyDocument` path never touches it and `get_users` would otherwise
   * answer "who is connected?" from the connect-time snapshot forever.
   *
   * Bound field rather than a method so the same reference reaches `socket.off()`.
   * Never throws: an unrecognized payload leaves presence as it was.
   */
  private onUserActivity = (userId: unknown, activityData?: unknown): void => {
    if (!this.worldData) {
      return;
    }

    const activity = parseUserActivity(userId, activityData);
    if (!activity) {
      logger.debug('Ignored unrecognized userActivity payload');
      return;
    }

    if (applyUserActivity(this.worldData, activity)) {
      logger.debug(
        `User ${activity.userId} is now ${activity.active ? 'active' : 'inactive'} (userActivity)`,
      );
    }
  };

  /**
   * Reacts to the socket dropping on its own — server restart, network loss,
   * an idle timeout (#217).
   *
   * Clears the connected flag so `isConnected()` and `get_health_status` stop
   * claiming a live link, and marks the cached snapshot stale: nothing is
   * applying `modifyDocument` broadcasts while the socket is down, so whatever
   * is in `worldData` from here on is a point-in-time copy, not live state.
   * The cache is deliberately *kept* rather than dropped — a stale answer with
   * an honest connection line beats no answer at all — and Socket.IO's own
   * reconnect logic may bring the link back, at which point `refreshWorldData()`
   * resyncs it.
   *
   * Bound field rather than a method so the same reference reaches `socket.off()`.
   */
  /**
   * Reacts to socket.io bringing the link back up on its own (#217).
   *
   * `sessionSocketOptions` leaves socket.io-client's default
   * `reconnection: true` in place, so after a transient drop the manager
   * re-handshakes the SAME socket instance (the session cookie rides along in
   * `extraHeaders`) and the persistent `modifyDocument`/`userActivity`
   * listeners resume firing. Without this the connected flag would stay
   * latched off for the rest of the process while writes and broadcasts were
   * demonstrably working again.
   *
   * `worldDataStale` is deliberately *not* cleared: broadcasts emitted while
   * the socket was down were never delivered and are not replayed, so the
   * cache stays flagged until an explicit `refreshWorldData()`.
   *
   * Bound field rather than a method so the same reference reaches `socket.off()`.
   */
  private onSocketConnect = (): void => {
    this._isConnected = true;
    logger.info('FoundryVTT socket reconnected — cached world data is still stale until refreshed');
  };

  private onSocketDisconnect = (reason?: unknown): void => {
    this._isConnected = false;
    this.worldDataStale = this.worldData !== null;
    logger.warn('FoundryVTT socket disconnected — cached world data is now stale', {
      reason: typeof reason === 'string' ? reason : undefined,
    });
  };

  /**
   * Closes the current socket and removes every persistent listener bound to
   * it. Used both by `disconnect()` and before a socket is replaced: a
   * superseded socket that kept its `disconnect` handler would otherwise clear
   * the connected flag of the live socket that replaced it when it finally
   * closed (`DiagnosticsClient.testAuthentication()` re-connects a live
   * client, so this is reachable in-repo).
   */
  private detachSocket(): void {
    if (!this.socket) {
      return;
    }
    this.socket.off('modifyDocument', this.onDocumentBroadcast);
    this.socket.off('modifyDocumentBatch', this.onDocumentBatchBroadcast);
    this.socket.off('userActivity', this.onUserActivity);
    this.socket.off('connect', this.onSocketConnect);
    this.socket.off('disconnect', this.onSocketDisconnect);
    this.socket.disconnect();
    this.socket = null;
  }

  async disconnect(): Promise<void> {
    this.detachSocket();
    this.worldData = null;
    this.worldDataStale = false;
    this._isConnected = false;
    this.restLinkLive = true;
    this.restState = undefined;
    this.restLastError = undefined;
    this.restRetryAfter = 0;
    this.restPauseError = undefined;
    this.restCapabilityPauses.clear();
    this.restFailuresLogged.clear();
    logger.info('FoundryVTT client disconnected');
  }

  /**
   * Reports whether the client currently has a live link to FoundryVTT (#217).
   *
   * Socket.IO mode answers from the socket itself rather than from a latched
   * flag, so a link that dropped without an explicit `disconnect()` — server
   * restart, network loss — reads as disconnected immediately, even if the
   * `disconnect` event has not been delivered yet. It tracks the socket in both
   * directions: an automatic reconnect (`onSocketConnect`) reads as connected
   * again rather than staying latched off.
   *
   * REST API mode (`FOUNDRY_API_KEY`) has no socket to ask, so it answers from
   * the last REST request that actually happened: a request that failed to
   * reach FoundryVTT (connection refused, reset, timed out) reads as
   * disconnected from then on, and the next request that gets through reads as
   * connected again. An HTTP error status does not count as a drop — the
   * server answered. This is a *last observed outcome*, not a live probe: it
   * cannot notice a server that went away between requests, and it never does
   * I/O of its own, because this accessor is synchronous and widely called.
   */
  isConnected(): boolean {
    if (this.mode === 'rest') {
      return this._isConnected && this.restLinkLive;
    }
    return this._isConnected && this.socket?.connected === true;
  }

  /**
   * True when the cached snapshot is no longer being kept live by broadcasts —
   * i.e. the socket dropped after a world load (#217). Reads still answer from
   * the cache; this flags that the answer is a point-in-time copy.
   */
  isWorldDataStale(): boolean {
    return this.worldDataStale;
  }

  /**
   * Returns true if worldData is available (Socket.IO mode connected).
   */
  hasWorldData(): boolean {
    return this.worldData !== null;
  }

  // ==========================================================================
  // World data accessors
  // ==========================================================================

  /**
   * Re-emits 'world' on the existing socket to refresh the cached snapshot.
   *
   * Registers a one-shot 'world' listener and cleans it up on every exit
   * path (success, error, timeout) via `socket.off()` so that repeated
   * refreshes over a long-running session do not leak listener handles.
   */
  async refreshWorldData(): Promise<void> {
    if (!this.socket?.connected) {
      throw new Error('Not connected — cannot refresh world data');
    }

    this.worldData = await new Promise<WorldData>((resolve, reject) => {
      const cleanup = () => {
        this.socket?.off('world', onWorld);
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Refresh timeout'));
      }, this.config.timeout ?? 15000);

      const onWorld = (data: WorldData) => {
        cleanup();
        clearTimeout(timeoutId);
        try {
          const parsed = WorldDataSchema.safeParse(data);
          if (!parsed.success) {
            logger.warn('WorldData refresh failed schema validation — proceeding with raw data', {
              issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
            });
          }
          resolve(data);
        } catch (err) {
          reject(err as Error);
        }
      };

      this.socket?.once('world', onWorld);
      this.socket?.emit('world');
    });

    this.worldDataStale = false;
    logger.info('World data refreshed', {
      actors: this.worldData.actors.length,
      items: this.worldData.items.length,
    });
  }

  getWorldData(): WorldData | null {
    return this.worldData;
  }

  // ==========================================================================
  // Actor methods
  // ==========================================================================

  /**
   * Searches actors. Base data comes from the first source the capability
   * table names for `actors`; in dual mode the bridge's prepared values are
   * then overlaid by actor id (`actor-derived` prefers REST), and a failed
   * bridge call leaves the Socket.IO answer as it was.
   */
  async searchActors(params: SearchActorsParams): Promise<ActorSearchResult> {
    if (this.preferred('actors') === 'rest') {
      const rest = this.requireRest();
      return this.executeWithRetry(async () => {
        const response = await rest.get('/api/actors', { params });
        return mapRestActorSearch(response.data, params.limit || 10);
      });
    }

    const result = this.searchActorsInWorld(params);
    if (this.preferred('actor-derived') !== 'rest' || result.actors.length === 0) {
      return result;
    }
    const restResult = await this.tryRest('actor-derived', async (rest) => {
      const response = await rest.get('/api/actors', { params });
      return mapRestActorSearch(response.data, params.limit || 10);
    });
    if (!restResult) {
      return result;
    }
    const byId = new Map(restResult.actors.map((actor) => [actor._id, actor]));
    return {
      ...result,
      actors: result.actors.map((actor) => {
        const prepared = byId.get(actor._id);
        return prepared ? overlayDerivedValues(actor, prepared) : actor;
      }),
    };
  }

  private searchActorsInWorld(params: SearchActorsParams): ActorSearchResult {
    if (!this.worldData) {
      return { actors: [], total: 0, page: 1, limit: params.limit || 10 };
    }

    let results = this.worldData.actors;

    if (params.query) {
      const q = params.query.toLowerCase();
      results = results.filter((a) => a.name.toLowerCase().includes(q));
    }
    if (params.type) {
      const t = params.type.toLowerCase();
      results = results.filter((a) => a.type.toLowerCase() === t);
    }

    const total = results.length;
    const limit = params.limit || 10;
    const actors: FoundryActor[] = results.slice(0, limit).map(worldActorToFoundry);

    return { actors, total, page: 1, limit };
  }

  async getActor(actorId: string): Promise<FoundryActor> {
    if (!FOUNDRY_ID_PATTERN.test(actorId)) {
      throw new Error(`Invalid actorId format: ${actorId}`);
    }
    const route = `/api/actors/${actorId}`;
    if (this.preferred('actors') === 'rest') {
      const rest = this.requireRest();
      return this.executeWithRetry(async () => {
        const response = await rest.get(route);
        return mapRestActor(response.data, route);
      });
    }

    if (!this.worldData) {
      throw new Error('Not connected — no world data available');
    }

    const raw = this.worldData.actors.find((a) => a._id === actorId);
    if (!raw) {
      throw new Error(`Actor not found: ${actorId}`);
    }

    const actor = worldActorToFoundry(raw);
    if (this.preferred('actor-derived') !== 'rest') {
      return actor;
    }
    const prepared = await this.tryRest('actor-derived', async (rest) => {
      const response = await rest.get(route);
      return mapRestActor(response.data, route);
    });
    return prepared ? overlayDerivedValues(actor, prepared) : actor;
  }

  /**
   * Returns the raw WorldActor with the full system data (game-system specific).
   */
  getRawActor(actorId: string): WorldActor | undefined {
    return this.worldData?.actors.find((a) => a._id === actorId);
  }

  /**
   * Patches attributes on an actor's `system` object (#143). WRITE — Socket.IO.
   *
   * `patch` keys are dot-paths into `actor.system` (e.g. `attributes.hp.value`,
   * `currency.gp`, `spells.spell1.value`, `attributes.exhaustion`). Each key is
   * prefixed with `system.` and sent through the Socket.IO `modifyDocument`
   * write protocol as an `Actor` `update` — matching FoundryVTT's own document
   * model (`Actor#update`). No REST call and no `apiKey` are involved.
   *
   * Client-side validation, using the actor's current data, rejects:
   *  - HP value exceeding `max + temp`,
   *  - spell-slot value exceeding its `max`,
   *  - exhaustion outside `0–10` (2024 rules) or `0–6` (2014 rules).
   *
   * @throws via `assertWriteable()` if `writeEnabled` is false or the socket
   *   is not connected; also if the id is malformed, the actor/path is missing,
   *   or a validation rule is violated.
   */
  async updateActorAttribute(
    actorId: string,
    patch: AttributePatch,
  ): Promise<ActorAttributeUpdateResult> {
    this.assertWriteable();
    if (!FOUNDRY_ID_PATTERN.test(actorId)) {
      throw new Error(`Invalid actorId format: ${actorId}`);
    }
    if (!isRecord(patch) || Object.keys(patch).length === 0) {
      throw new Error('patch is required and must contain at least one attribute path');
    }

    // Fetch current actor data to validate paths and bounds. getActor returns
    // the mapped actor in socket mode (no `system`), so fall back to the cached
    // raw actor for the system document the validator needs.
    const actor = await this.getActor(actorId);
    const rawSystem = systemOf(actor) ?? systemOf(this.getRawActor(actorId));
    validateAttributePatch(patch, actor, rawSystem);

    // The patch keys are dot-paths into `actor.system`; prefix each with
    // `system.` for the document update. FoundryVTT accepts dot-notation keys
    // in update objects and merges recursively.
    const update: Record<string, unknown> = { _id: actorId };
    for (const [path, value] of Object.entries(patch)) {
      update[`system.${path}`] = value;
    }
    const result = await this.modifyDocument('Actor', 'update', {
      updates: [update],
      diff: true,
      recursive: true,
    });

    // Echo the post-update value for each patched path. Prefer the server's
    // returned document when present; otherwise reflect the requested value.
    const returned = isRecord(result[0]) ? (result[0] as Record<string, unknown>) : undefined;
    const updatedAttributes: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(patch)) {
      const fromServer = returned ? getDotPath(returned, `system.${path}`) : undefined;
      updatedAttributes[path] = fromServer !== undefined ? fromServer : value;
    }

    return { success: true, updatedAttributes };
  }

  // ==========================================================================
  // Item methods
  // ==========================================================================

  async searchItems(params: SearchItemsParams): Promise<ItemSearchResult> {
    if (this.preferred('items') === 'rest') {
      const rest = this.requireRest();
      return this.executeWithRetry(async () => {
        const response = await rest.get('/api/items', { params });
        return mapRestItemSearch(response.data, params.limit || 10);
      });
    }

    if (!this.worldData) {
      return { items: [], total: 0, page: 1, limit: params.limit || 10 };
    }

    let results = this.worldData.items;

    if (params.query) {
      const q = params.query.toLowerCase();
      results = results.filter((i) => i.name.toLowerCase().includes(q));
    }
    if (params.type) {
      const t = params.type.toLowerCase();
      results = results.filter((i) => i.type.toLowerCase() === t);
    }

    const total = results.length;
    const limit = params.limit || 10;
    const items = results.slice(0, limit).map(worldItemToFoundry);

    return { items, total, page: 1, limit };
  }

  // ==========================================================================
  // Compendium methods
  // ==========================================================================

  /**
   * Searches FoundryVTT compendium packs by name and metadata.
   *
   * Compendium data is not present in the cached worldData snapshot, so this
   * read needs the REST bridge. Without one it returns a graceful empty result
   * with `restAvailable: false` rather than throwing; in dual mode a failed
   * bridge call returns the same result with `unavailableReason` set. The
   * handler surfaces a note explaining why no results were returned. REST-only
   * mode keeps throwing on failure, as before.
   */
  async searchCompendium(params: CompendiumSearchParams): Promise<CompendiumSearchResult> {
    const limit = params.limit ?? 20;
    const offset = decodeCursor(params.cursor);
    const unavailable: CompendiumSearchResult = {
      results: [],
      total: 0,
      page: 1,
      limit,
      restAvailable: false,
      nextCursor: null,
    };
    // Translate the opaque cursor into a wire offset for the bridge.
    const { cursor: _cursor, ...query } = params;
    const search = async (rest: AxiosInstance) => {
      const response = await rest.get('/api/compendium/search', {
        params: { ...query, limit, offset },
      });
      return mapRestCompendiumSearch(response.data, { limit, offset });
    };

    if (this.preferred('compendium') !== 'rest') {
      return unavailable;
    }
    if (this.mode === 'rest') {
      const rest = this.requireRest();
      return this.executeWithRetry(() => search(rest));
    }
    const result = await this.tryRest('compendium', search);
    return (
      result ?? {
        ...unavailable,
        unavailableReason: `the REST bridge is unavailable (${this.restLastError ?? 'paused after a failed request'})`,
      }
    );
  }

  // ==========================================================================
  // Write helpers (Socket.IO `modifyDocument` — primary transport, PRD-003)
  // ==========================================================================

  /**
   * Guards a write operation. Writes require the `FOUNDRY_WRITE_ENABLED` opt-in
   * and an active authenticated Socket.IO session (the primary transport).
   * Throws a clear, actionable error otherwise.
   */
  private assertWriteable(): void {
    if (!this.config.writeEnabled) {
      throw new Error(
        'Write operations are disabled. Set FOUNDRY_WRITE_ENABLED=true to allow game-state mutation.',
      );
    }
    if (!this.socket?.connected) {
      throw new Error(
        'Write operations require an active Socket.IO connection to FoundryVTT (username/password mode).',
      );
    }
  }

  /**
   * Emits a Socket.IO event with an acknowledgement callback, resolving the
   * server's response and rejecting on timeout. Mirrors the ack pattern used by
   * the `world` event in {@link connectAndLoadWorld}/{@link refreshWorldData}.
   */
  private emitWithAck<T>(event: string, payload: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const socket = this.socket;
      if (!socket?.connected) {
        reject(new Error('Socket.IO is not connected'));
        return;
      }
      const timeoutMs = this.config.timeout || 10000;
      const timeout = setTimeout(
        () => reject(new Error(`Timeout waiting for '${event}' response (${timeoutMs}ms)`)),
        timeoutMs,
      );
      socket.emit(event, payload, (response: T) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
  }

  /**
   * Performs a FoundryVTT document mutation over Socket.IO using the core
   * `modifyDocument` protocol. The request shape is verified against the
   * v13.348 and v14.369 builds (client `ClientDatabaseBackend` request
   * building and dispatch, server `ServerDatabaseBackend` socket handler,
   * `common/abstract/socket.mjs`); see `.claude/rules/foundry-write-protocol.md`.
   *
   * The acknowledgement is a single response, or — from v14, when the write had
   * server-side side effects — `{ results: [...] }` holding the side-effect
   * responses and the primary one (#232). Either way the primary response's
   * `result` is returned, and any error in the set rejects.
   *
   * @param type - Document name ("Actor", "Item", …)
   * @param action - "create" | "update" | "delete"
   * @param operation - action-specific payload: `data` (create) / `updates`
   *   (update) / `ids` (delete), plus `parentUuid` for embedded documents.
   * @returns the primary response's `result` array (created/updated data, or
   *   deleted ids)
   */
  private async modifyDocument(
    type: string,
    action: 'create' | 'update' | 'delete',
    operation: Record<string, unknown>,
  ): Promise<unknown[]> {
    const request = {
      type,
      action,
      operation: { broadcast: true, pack: null, modifiedTime: Date.now(), ...operation },
    };
    const ack = ModifyDocumentAckSchema.safeParse(
      await this.emitWithAck<unknown>('modifyDocument', request),
    );
    if (!ack.success) {
      throw new Error(`Unrecognized modifyDocument acknowledgement for ${action} ${type}`);
    }
    const responses: DocumentSocketResponse[] =
      'results' in ack.data ? ack.data.results : [ack.data];
    const failed = responses.find((response) => response.error);
    if (failed?.error) {
      throw new Error(
        `FoundryVTT rejected ${action} ${type}: ${failed.error.message || 'unknown error'}`,
      );
    }
    const primary = responses.find((response) => !response.sideEffect);
    return primary?.result ?? [];
  }

  // ==========================================================================
  // Item mutation methods (WRITE — Socket.IO modifyDocument)
  // ==========================================================================

  /**
   * Creates a new item on an actor via the `modifyDocument` socket protocol.
   *
   * Inline sources are created directly. Compendium sources are NOT yet
   * supported over Socket.IO — copying a pack entry needs a compendium read
   * that `modifyDocument` does not provide (tracked in issue #159).
   *
   * @param actorId - 16-char alphanumeric actor document id
   * @param source - inline item document (compendium source throws)
   * @returns the newly created item document
   */
  async createActorItem(actorId: string, source: ActorItemCreateSource): Promise<FoundryItem> {
    this.assertWriteable();
    if (!FOUNDRY_ID_PATTERN.test(actorId)) {
      throw new Error(`Invalid actorId format: ${actorId}`);
    }
    if (source.type === 'compendium') {
      throw new Error(
        'Creating an item from a compendium source is not yet supported over Socket.IO; ' +
          'provide an inline item instead. See issue #159.',
      );
    }
    const result = await this.modifyDocument('Item', 'create', {
      data: [source.item],
      parentUuid: `Actor.${actorId}`,
    });
    return result[0] as FoundryItem;
  }

  /**
   * Applies a JSON merge patch to an item owned by an actor.
   *
   * The `patch` is merged into the item's `system` data (recursively, so nested
   * paths like the D&D 5e v4+ `activities.{id}.consumption.targets` are
   * preserved). Performed via the `modifyDocument` socket protocol.
   *
   * @param actorId - 16-char alphanumeric actor document id
   * @param itemId - 16-char alphanumeric item document id
   * @param patch - shallow/nested JSON merge patch applied to `item.system`
   * @returns the updated item document
   */
  async updateActorItem(
    actorId: string,
    itemId: string,
    patch: Record<string, unknown>,
  ): Promise<FoundryItem> {
    this.assertWriteable();
    if (!FOUNDRY_ID_PATTERN.test(actorId)) {
      throw new Error(`Invalid actorId format: ${actorId}`);
    }
    if (!FOUNDRY_ID_PATTERN.test(itemId)) {
      throw new Error(`Invalid itemId format: ${itemId}`);
    }
    const result = await this.modifyDocument('Item', 'update', {
      updates: [{ _id: itemId, system: patch }],
      parentUuid: `Actor.${actorId}`,
      diff: true,
      recursive: true,
    });
    return result[0] as FoundryItem;
  }

  /**
   * Deletes an item owned by an actor via the `modifyDocument` socket protocol.
   *
   * @param actorId - 16-char alphanumeric actor document id
   * @param itemId - 16-char alphanumeric item document id
   */
  async deleteActorItem(actorId: string, itemId: string): Promise<void> {
    this.assertWriteable();
    if (!FOUNDRY_ID_PATTERN.test(actorId)) {
      throw new Error(`Invalid actorId format: ${actorId}`);
    }
    if (!FOUNDRY_ID_PATTERN.test(itemId)) {
      throw new Error(`Invalid itemId format: ${itemId}`);
    }
    await this.modifyDocument('Item', 'delete', {
      ids: [itemId],
      parentUuid: `Actor.${actorId}`,
    });
  }

  // ==========================================================================
  // Combat mutation methods (WRITE — Socket.IO modifyDocument, FR-018)
  // ==========================================================================

  /**
   * Updates the active combat's turn/round pointers (FR-018).
   *
   * `Combat` is a top-level document, so the update carries no `parentUuid`.
   * The patch fields map directly onto the Combat document (`turn`, `round`).
   *
   * @param combatId - 16-char alphanumeric Combat document id
   * @param patch - turn and/or round to set on the combat
   * @returns the updated combat document
   */
  async updateCombat(combatId: string, patch: { turn?: number; round?: number }): Promise<unknown> {
    this.assertWriteable();
    if (!FOUNDRY_ID_PATTERN.test(combatId)) {
      throw new Error(`Invalid combatId format: ${combatId}`);
    }
    const result = await this.modifyDocument('Combat', 'update', {
      updates: [{ _id: combatId, ...patch }],
      diff: true,
      recursive: true,
    });
    return result[0];
  }

  /**
   * Ends (deletes) the active combat encounter (FR-018).
   *
   * @param combatId - 16-char alphanumeric Combat document id
   */
  async endCombat(combatId: string): Promise<void> {
    this.assertWriteable();
    if (!FOUNDRY_ID_PATTERN.test(combatId)) {
      throw new Error(`Invalid combatId format: ${combatId}`);
    }
    await this.modifyDocument('Combat', 'delete', { ids: [combatId] });
  }

  /**
   * Sets a combatant's initiative (FR-018).
   *
   * `Combatant` is an embedded document inside `Combat`, so the update is sent
   * with `parentUuid: "Combat.<combatId>"`.
   *
   * @param combatId - 16-char alphanumeric Combat document id (the parent)
   * @param combatantId - 16-char alphanumeric Combatant document id
   * @param initiative - finite initiative value to assign
   * @returns the updated combatant document
   */
  async setCombatantInitiative(
    combatId: string,
    combatantId: string,
    initiative: number,
  ): Promise<unknown> {
    this.assertWriteable();
    if (!FOUNDRY_ID_PATTERN.test(combatId)) {
      throw new Error(`Invalid combatId format: ${combatId}`);
    }
    if (!FOUNDRY_ID_PATTERN.test(combatantId)) {
      throw new Error(`Invalid combatantId format: ${combatantId}`);
    }
    if (typeof initiative !== 'number' || !Number.isFinite(initiative)) {
      throw new Error(`Invalid initiative: ${initiative} (must be a finite number)`);
    }
    const result = await this.modifyDocument('Combatant', 'update', {
      updates: [{ _id: combatantId, initiative }],
      parentUuid: `Combat.${combatId}`,
      diff: true,
      recursive: true,
    });
    return result[0];
  }

  /**
   * Starts a new combat encounter and seeds its combatants (FR-018, #172).
   *
   * Two-step `modifyDocument` flow:
   *   1. Create the top-level `Combat` document (no `parentUuid`), activated on
   *      the given scene, and read its `_id` from the response.
   *   2. Create the embedded `Combatant` documents with
   *      `parentUuid: "Combat.<combatId>"` (mirrors the Combatant→Combat embed
   *      used by {@link setCombatantInitiative}).
   *
   * The create wire shape is verified against the v13.348 and v14.369 builds per
   * `.claude/rules/foundry-write-protocol.md`; smoke-test one live round-trip
   * when changing it.
   *
   * @param sceneId - 16-char alphanumeric Scene document id the combat runs on
   * @param combatants - combatant seeds ({ tokenId, sceneId, actorId? })
   * @returns the new combat id and the number of combatants created
   */
  async startCombat(
    sceneId: string,
    combatants: Array<{ tokenId: string; sceneId: string; actorId?: string | undefined }>,
  ): Promise<{ combatId: string; combatantCount: number }> {
    this.assertWriteable();
    if (!FOUNDRY_ID_PATTERN.test(sceneId)) {
      throw new Error(`Invalid sceneId format: ${sceneId}`);
    }
    for (const c of combatants) {
      if (!FOUNDRY_ID_PATTERN.test(c.tokenId)) {
        throw new Error(`Invalid tokenId format: ${c.tokenId}`);
      }
    }

    const created = await this.modifyDocument('Combat', 'create', {
      data: [{ scene: sceneId, active: true }],
    });
    const combat = created[0] as { _id?: string } | undefined;
    const combatId = combat?._id;
    if (!combatId) {
      throw new Error('FoundryVTT did not return a Combat id after create');
    }

    if (combatants.length > 0) {
      await this.modifyDocument('Combatant', 'create', {
        data: combatants,
        parentUuid: `Combat.${combatId}`,
      });
    }

    return { combatId, combatantCount: combatants.length };
  }

  // ==========================================================================
  // Token mutation methods (WRITE — Socket.IO modifyDocument, FR-019)
  // ==========================================================================

  /**
   * Locates a token (and the scene it lives on) in the cached worldData.
   *
   * `Token` is an embedded document of `Scene`; worldData carries each scene's
   * tokens as raw records. When `sceneId` is omitted the search spans every
   * scene, so a token can be moved/affected without first resolving its scene.
   *
   * @param tokenId - 16-char alphanumeric Token document id
   * @param sceneId - optional Scene id to scope the search to
   * @returns the owning scene and the raw token record, or null if not found
   */
  findToken(
    tokenId: string,
    sceneId?: string,
  ): { scene: WorldScene; token: Record<string, unknown> } | null {
    if (!this.worldData) {
      return null;
    }
    const scenes = sceneId
      ? this.worldData.scenes.filter((s) => s._id === sceneId)
      : this.worldData.scenes;
    for (const scene of scenes) {
      const token = scene.tokens?.find((t) => (t as { _id?: string })._id === tokenId);
      if (token) {
        return { scene, token };
      }
    }
    return null;
  }

  /**
   * Moves a token to new x/y coordinates (FR-019).
   *
   * `Token` is an embedded document of `Scene`, so the update is sent with
   * `parentUuid: "Scene.<sceneId>"` (mirrors the Combatant→Combat embed). The
   * wire shape is verified against the v13.348 and v14.369 builds per
   * `.claude/rules/foundry-write-protocol.md`.
   *
   * @param sceneId - 16-char alphanumeric Scene document id (the parent)
   * @param tokenId - 16-char alphanumeric Token document id
   * @param x - target x pixel coordinate (finite number)
   * @param y - target y pixel coordinate (finite number)
   * @returns the updated token document
   */
  async moveToken(sceneId: string, tokenId: string, x: number, y: number): Promise<unknown> {
    this.assertWriteable();
    if (!FOUNDRY_ID_PATTERN.test(sceneId)) {
      throw new Error(`Invalid sceneId format: ${sceneId}`);
    }
    if (!FOUNDRY_ID_PATTERN.test(tokenId)) {
      throw new Error(`Invalid tokenId format: ${tokenId}`);
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Invalid coordinates: (${x}, ${y}) — x and y must be finite numbers`);
    }
    const result = await this.modifyDocument('Token', 'update', {
      updates: [{ _id: tokenId, x, y }],
      parentUuid: `Scene.${sceneId}`,
      diff: true,
      recursive: true,
    });
    return result[0];
  }

  /**
   * Creates a status-effect `ActiveEffect` on a token's actor (FR-019).
   *
   * `ActiveEffect` is an embedded document of `Actor`, so the create is sent with
   * the actor's parent UUID:
   *  - `Actor.<id>` for a world-linked actor (`actorLink: true`)
   *  - `Scene.<sid>.Token.<tid>.Actor.<aid>` for an unlinked token's synthetic
   *    actor (the per-token delta).
   *
   * The effect carries a `statuses` array, matching how FoundryVTT v11+ models
   * conditions (`Actor#toggleStatusEffect` toggles by this field).
   *
   * @param parentActorUuid - the token actor's parent UUID (see forms above)
   * @param statusId - condition id (e.g. "prone", "stunned")
   * @param options - optional display `name` (defaults to `statusId`) and `img`
   * @returns the newly created ActiveEffect document
   */
  async createActorStatusEffect(
    parentActorUuid: string,
    statusId: string,
    options: { name?: string; img?: string } = {},
  ): Promise<WorldEffect> {
    this.assertWriteable();
    if (!TOKEN_ACTOR_UUID_PATTERN.test(parentActorUuid)) {
      throw new Error(`Invalid actor UUID format: ${parentActorUuid}`);
    }
    if (!statusId || typeof statusId !== 'string') {
      throw new Error('statusId is required and must be a string');
    }
    const effectData: Record<string, unknown> = {
      name: options.name ?? statusId,
      statuses: [statusId],
    };
    if (options.img) {
      effectData.img = options.img;
    }
    const result = await this.modifyDocument('ActiveEffect', 'create', {
      data: [effectData],
      parentUuid: parentActorUuid,
    });
    return result[0] as WorldEffect;
  }

  /**
   * Deletes an `ActiveEffect` from a token's actor (FR-019), e.g. to clear a
   * status condition. Accepts the same parent-UUID forms as
   * {@link createActorStatusEffect}.
   *
   * @param parentActorUuid - the token actor's parent UUID
   * @param effectId - 16-char alphanumeric ActiveEffect document id
   */
  async deleteActorEffect(parentActorUuid: string, effectId: string): Promise<void> {
    this.assertWriteable();
    if (!TOKEN_ACTOR_UUID_PATTERN.test(parentActorUuid)) {
      throw new Error(`Invalid actor UUID format: ${parentActorUuid}`);
    }
    if (!FOUNDRY_ID_PATTERN.test(effectId)) {
      throw new Error(`Invalid effectId format: ${effectId}`);
    }
    await this.modifyDocument('ActiveEffect', 'delete', {
      ids: [effectId],
      parentUuid: parentActorUuid,
    });
  }

  // ==========================================================================
  // Scene methods
  // ==========================================================================

  async getCurrentScene(sceneId?: string): Promise<FoundryScene> {
    if (sceneId !== undefined && !FOUNDRY_ID_PATTERN.test(sceneId)) {
      throw new Error(`Invalid sceneId format: ${sceneId}`);
    }
    if (this.preferred('scenes') === 'rest') {
      const rest = this.requireRest();
      const endpoint = sceneId ? `/api/scenes/${sceneId}` : '/api/scenes/current';
      return this.executeWithRetry(async () => {
        const response = await rest.get(endpoint);
        return mapRestScene(response.data, endpoint);
      });
    }

    if (!this.worldData) {
      throw new Error('Not connected — no world data available');
    }

    let scene: WorldScene | undefined;
    if (sceneId) {
      scene = this.worldData.scenes.find((s) => s._id === sceneId);
    } else {
      scene = this.worldData.scenes.find((s) => s.active);
    }

    if (!scene) {
      throw new Error(sceneId ? `Scene not found: ${sceneId}` : 'No active scene');
    }

    return worldSceneToFoundry(scene);
  }

  async getScene(sceneId: string): Promise<FoundryScene> {
    return this.getCurrentScene(sceneId);
  }

  getScenes(): WorldScene[] {
    return this.worldData?.scenes || [];
  }

  // ==========================================================================
  // World info
  // ==========================================================================

  async getWorldInfo(): Promise<FoundryWorld> {
    if (this.preferred('world-info') === 'rest') {
      const rest = this.requireRest();
      return this.executeWithRetry(async () => {
        const response = await rest.get('/api/world');
        return mapRestWorld(response.data);
      });
    }

    if (!this.worldData) {
      return {
        id: 'unknown',
        title: 'Not connected',
        description: 'Connect to FoundryVTT to retrieve world information',
        system: 'unknown',
        coreVersion: 'unknown',
        systemVersion: 'unknown',
        playtime: 0,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };
    }

    return worldInfoToFoundry(this.worldData);
  }

  // ==========================================================================
  // Combat
  // ==========================================================================

  getCombatState(): WorldCombat | null {
    if (!this.worldData) {
      return null;
    }
    return this.worldData.combats.find((c) => c.active) ?? null;
  }

  // ==========================================================================
  // Chat messages
  // ==========================================================================

  getChatMessages(limit = 20): WorldMessage[] {
    if (!this.worldData) {
      return [];
    }
    return this.worldData.messages.slice(-limit);
  }

  // ==========================================================================
  // Users
  // ==========================================================================

  getUsers(): { users: WorldUser[]; activeUsers: string[] } {
    if (!this.worldData) {
      return { users: [], activeUsers: [] };
    }
    return {
      users: this.worldData.users,
      activeUsers: this.worldData.activeUsers,
    };
  }

  // ==========================================================================
  // Journals
  // ==========================================================================

  getJournals(): WorldJournal[] {
    return this.worldData?.journal || [];
  }

  searchJournals(query: string): WorldJournal[] {
    if (!this.worldData) {
      return [];
    }
    const q = query.toLowerCase();
    return this.worldData.journal.filter((j) => {
      if (j.name.toLowerCase().includes(q)) {
        return true;
      }
      return j.pages?.some(
        (p) => p.name.toLowerCase().includes(q) || p.text?.content?.toLowerCase().includes(q),
      );
    });
  }

  getJournal(journalId: string): WorldJournal | undefined {
    return this.worldData?.journal.find((j) => j._id === journalId);
  }

  // ==========================================================================
  // Journal mutation methods (WRITE — Socket.IO modifyDocument)
  // ==========================================================================

  /**
   * Creates a new JournalEntry with one or more text pages.
   *
   * `JournalEntry` is a top-level document (unlike Item/ActiveEffect, which
   * are embedded in an Actor), so the create carries no `parentUuid` —
   * mirrors {@link startCombat}'s top-level Combat create. Each entry in
   * `pages` is mapped to Foundry's native `JournalEntryPage` text-page shape,
   * with an explicit `sort` so the pages render in the order supplied.
   *
   * @param name - journal entry title
   * @param pages - one or more pages (name + content); at least one required
   * @param folder - optional 16-char Folder document id to file the entry under
   * @param visibility - who can see the entry (#204); omitted means GM-only,
   *   which is FoundryVTT's default for a newly created document
   * @returns the newly created journal entry document
   */
  async createJournalEntry(
    name: string,
    pages: JournalPageCreateSource[],
    folder?: string,
    visibility?: DocumentVisibility,
  ): Promise<WorldJournal> {
    this.assertWriteable();
    if (!name || typeof name !== 'string') {
      throw new Error('name is required and must be a string');
    }
    if (!Array.isArray(pages) || pages.length === 0) {
      throw new Error('pages is required and must contain at least one page');
    }
    if (folder !== undefined && !FOUNDRY_ID_PATTERN.test(folder)) {
      throw new Error(`Invalid folder format: ${folder}`);
    }
    if (visibility !== undefined && !(visibility in VISIBILITY_LEVELS)) {
      throw new Error(
        `Invalid visibility: ${visibility}. Expected one of: ${Object.keys(VISIBILITY_LEVELS).join(', ')}`,
      );
    }

    const data: Record<string, unknown> = {
      name,
      pages: pages.map((p, i) => ({
        name: p.name,
        type: 'text',
        text: { content: p.content, format: 1 },
        sort: (i + 1) * SORT_INTEGER_DENSITY,
      })),
    };
    if (folder) {
      data.folder = folder;
    }
    if (visibility) {
      data.ownership = { default: VISIBILITY_LEVELS[visibility] };
    }

    const result = await this.modifyDocument('JournalEntry', 'create', {
      data: [data],
    });
    return result[0] as WorldJournal;
  }

  // ==========================================================================
  // Cross-collection search
  // ==========================================================================

  searchWorld(query: string): WorldSearchResults {
    return searchWorldDocuments(this.worldData, query);
  }

  // ==========================================================================
  // World summary
  // ==========================================================================

  getWorldSummary(): Record<string, number> {
    if (!this.worldData) {
      return {};
    }
    return {
      actors: this.worldData.actors.length,
      items: this.worldData.items.length,
      scenes: this.worldData.scenes.length,
      journals: this.worldData.journal.length,
      combats: this.worldData.combats.length,
      users: this.worldData.users.length,
      messages: this.worldData.messages.length,
      macros: this.worldData.macros.length,
      playlists: this.worldData.playlists.length,
      tables: this.worldData.tables.length,
      folders: this.worldData.folders.length,
    };
  }

  // ==========================================================================
  // Dice rolling
  // ==========================================================================

  /**
   * Rolls a dice formula.
   *
   * Validation is deliberately **per transport**, because the two transports
   * are not equally capable (#219):
   *
   *  - **REST (`FOUNDRY_API_KEY`)** posts the formula to `/api/dice/roll`,
   *    where FoundryVTT's own `Roll` engine evaluates it. That engine
   *    understands more than this module does — parentheses, for one — so only
   *    the `DICE_FORMULA_ALPHABET` check applies here. Imposing the local
   *    parser's narrower grammar would take away a capability the transport
   *    has. What the alphabet does refuse is refused by name and position
   *    (`unexpected "k" at position 3`, via `alphabetViolation`), so the
   *    two transports are equally specific about what they would not evaluate.
   *  - **Socket.IO / no API key** has no remote evaluator: `fallbackDiceRoll`
   *    is the roller, so the grammar its parser can represent is the grammar
   *    accepted, and that parser is the *only* gate. No alphabet pre-check runs
   *    ahead of it, so its specific message (`unexpected "k" at position 3`)
   *    reaches the caller instead of a generic `Invalid dice formula: 4d6kh3`.
   *    Nothing is ever dropped from a total in silence.
   *
   * The length cap is common to both. A REST roll that cannot reach FoundryVTT
   * falls through to the local roller, which then applies the strict grammar —
   * a formula only Foundry could evaluate errors out rather than being
   * mis-totalled locally.
   */
  async rollDice(formula: string, reason?: string): Promise<DiceRoll> {
    if (typeof formula !== 'string' || formula.length > MAX_DICE_FORMULA_LENGTH) {
      throw new Error(`Invalid dice formula: ${formula}`);
    }

    if (this.preferred('dice') === 'rest') {
      if (!formula || !DICE_FORMULA_ALPHABET.test(formula)) {
        throw alphabetViolation(formula);
      }
      const body = reason ? { formula, reason } : { formula };
      const roll = async (rest: AxiosInstance) => {
        const response = await rest.post('/api/dice/roll', body);
        return mapRestDiceRoll(response.data, formula, reason);
      };

      if (this.mode === 'dual') {
        // Augment semantics: one logged failure, then the local roller.
        const rolled = await this.tryRest('dice', roll);
        if (rolled) {
          return rolled;
        }
      } else {
        try {
          return await roll(this.requireRest());
        } catch (error) {
          // Keep the fallback, but never in silence (#254): the result is marked
          // `source: 'local'` and the failure is logged without the request
          // config, which carries the API key header.
          logger.warn(
            'REST dice roll failed — falling back to the local roller',
            describeRestFailure(error),
          );
        }
      }
    }

    return this.fallbackDiceRoll(formula, reason);
  }

  /**
   * Rolls locally, when FoundryVTT is not doing it for us.
   *
   * Delegates the whole formula to {@link evaluateDiceFormula}, which consumes
   * the input end to end and throws on any leftover it cannot represent (#219).
   */
  private fallbackDiceRoll(formula: string, reason?: string): DiceRoll {
    const { total, breakdown } = evaluateDiceFormula(formula);

    const result: DiceRoll = {
      formula,
      total,
      breakdown,
      timestamp: new Date().toISOString(),
      source: 'local',
    };
    if (reason) {
      result.reason = reason;
    }
    return result;
  }

  // ==========================================================================
  // Connection test
  // ==========================================================================

  /**
   * Verifies that the configured transport can authenticate to the Foundry world.
   * connect() uses the authenticated /api/world probe in REST mode and the
   * authenticated Socket.IO handshake otherwise. A public '/' response is
   * not sufficient to establish that either connection is usable.
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.connect();
      logger.debug('Authenticated connection test successful', {
        transport: this.mode,
      });
      return true;
    } catch (error) {
      logger.error('Failed to connect to FoundryVTT:', error);
      throw error;
    }
  }

  // ==========================================================================
  // HTTP helpers (preserved for REST API mode and diagnostics)
  // ==========================================================================

  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    const maxAttempts = (this.config.retryAttempts || 3) + 1;
    const baseDelay = this.config.retryDelay || 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // A body the module would never send, or a failure it reported, does
        // not change on a retry.
        if (error instanceof RestShapeError || error instanceof RestRequestError) {
          throw error;
        }

        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          if (status && status >= 400 && status < 500 && status !== 429) {
            throw lastError;
          }
        }

        if (attempt === maxAttempts) {
          throw lastError;
        }

        const exponentialDelay = baseDelay * 2 ** (attempt - 1);
        const jitter = Math.random() * 0.1 * exponentialDelay;
        await new Promise((resolve) => setTimeout(resolve, exponentialDelay + jitter));
      }
    }

    throw lastError || new Error('Request failed after all retry attempts');
  }

  /**
   * The client `/api/*` helpers use: the REST server when one is configured
   * (it holds the key), Foundry otherwise.
   */
  private apiHttp(): AxiosInstance {
    return this.rest ?? this.http;
  }

  /** First source the capability table names for `capability` in this mode. */
  private preferred(capability: Capability): string | undefined {
    return sourceOrder(capability, this.mode)[0];
  }

  /** The REST client; only called on paths the capability table routes to REST. */
  private requireRest(): AxiosInstance {
    if (!this.rest) {
      throw new Error('The REST bridge is not configured.');
    }
    return this.rest;
  }

  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(() => this.apiHttp().get(url, config));
  }

  async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(() => this.apiHttp().post(url, data, config));
  }

  async put<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(() => this.apiHttp().put(url, data, config));
  }

  async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(() => this.apiHttp().delete(url, config));
  }
}

// ============================================================================
// Mapping helpers — WorldData raw documents → display interfaces
//
// Exported for the transport parity tests (parity-contract.test.ts), which run
// the same dnd5e scenario through these and through rest-mappers.ts.
// ============================================================================

/** A Socket.IO world (or actor-owned) item → {@link FoundryItem}. */
export function worldItemToFoundry(i: WorldItem): FoundryItem {
  const item: FoundryItem = {
    _id: i._id,
    name: i.name,
    type: i.type,
  };
  if (i.img) {
    item.img = i.img;
  }
  const desc = extractString(i.system, 'description', 'value');
  if (desc) {
    item.description = desc;
  }
  const rar = extractString(i.system, 'rarity');
  if (rar) {
    item.rarity = rar;
  }
  return item;
}

/** The Socket.IO world snapshot's world, system and release data → {@link FoundryWorld}. */
export function worldInfoToFoundry(worldData: WorldData): FoundryWorld {
  const w = worldData.world as Record<string, unknown>;
  const s = worldData.system as Record<string, unknown>;
  const r = worldData.release as Record<string, unknown>;

  return {
    id: (w.id as string) || 'unknown',
    title: (w.title as string) || 'Unknown World',
    description: (w.description as string) || '',
    system: (s.id as string) || 'unknown',
    coreVersion: (r.version as string) || (r.generation as string) || 'unknown',
    systemVersion: (s.version as string) || 'unknown',
    playtime: 0,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
  };
}

export function worldActorToFoundry(a: WorldActor): FoundryActor {
  const sys = a.system || {};
  const hpRaw = extractNested(sys, 'attributes', 'hp');
  const hp = isRecord(hpRaw) ? hpRaw : undefined;
  const acRaw = extractNested(sys, 'attributes', 'ac');
  const ac = isRecord(acRaw) ? acRaw : undefined;
  const details = isRecord(sys.details) ? sys.details : {};

  const abilitiesRaw = sys.abilities;
  let mappedAbilities: FoundryActor['abilities'];
  if (isRecord(abilitiesRaw)) {
    mappedAbilities = {};
    for (const [key, val] of Object.entries(abilitiesRaw)) {
      if (isRecord(val)) {
        const value = typeof val.value === 'number' ? val.value : 10;
        const entry: { value: number; mod: number; save?: number } = {
          value,
          // dnd5e source data has no `mod`; it is exact from the score (#308).
          mod: typeof val.mod === 'number' ? val.mod : abilityModifier(value),
        };
        if (typeof val.save === 'number') {
          entry.save = val.save;
        }
        mappedAbilities[key] = entry;
      }
    }
  }

  const actor: FoundryActor = {
    _id: a._id,
    name: a.name,
    type: a.type,
  };

  if (a.img) {
    actor.img = a.img;
  }

  if (hp) {
    const hpObj: { value?: number; max?: number; temp?: number } = {};
    if (typeof hp.value === 'number') {
      hpObj.value = hp.value;
    }
    if (typeof hp.max === 'number') {
      hpObj.max = hp.max;
    }
    if (typeof hp.temp === 'number') {
      hpObj.temp = hp.temp;
    }
    actor.hp = hpObj;
  }

  const derivedUnavailable: DerivedActorField[] = [];

  if (hp && typeof hp.max !== 'number') {
    derivedUnavailable.push('hpMax');
  }

  if (ac) {
    const acValue = typeof ac.value === 'number' ? ac.value : flatArmorClass(ac);
    if (acValue === undefined) {
      derivedUnavailable.push('ac');
    } else {
      actor.ac = { value: acValue };
    }
  }

  if (typeof details.level === 'number') {
    actor.level = details.level;
  } else if (a.type === 'character') {
    // dnd5e source data has no `details.level`; it is the class-item sum (#308).
    const level = characterClassLevel(a.items);
    if (level !== undefined) {
      actor.level = level;
      const attributes = isRecord(sys.attributes) ? sys.attributes : {};
      const prof = typeof attributes.prof === 'number' ? attributes.prof : proficiencyBonus(level);
      actor.attributes = { prof };
    }
  }

  if (derivedUnavailable.length > 0) {
    actor.derivedUnavailable = derivedUnavailable;
  }

  if (mappedAbilities) {
    actor.abilities = mappedAbilities;
  }

  const bio = extractString(details, 'biography', 'value') || extractString(details, 'biography');
  if (bio) {
    actor.biography = bio;
  }

  return actor;
}

function worldSceneToFoundry(s: WorldScene): FoundryScene {
  const scene: FoundryScene = {
    _id: s._id,
    name: s.name,
    active: s.active,
    navigation: s.navigation,
    width: s.width,
    height: s.height,
    padding: s.padding,
    shiftX: 0,
    shiftY: 0,
    globalLight: s.globalLight,
    darkness: s.darkness,
  };
  if (s.img) {
    scene.img = s.img;
  }
  const desc = (s.flags as Record<string, unknown>)?.description;
  if (typeof desc === 'string') {
    scene.description = desc;
  }
  return scene;
}

/**
 * Safely extracts a nested value from a Record tree.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Returns the `system` object of an actor-like document, accepting either the
 * raw REST/world document (`{ ..., system }`) or a cached {@link WorldActor}.
 * Returns undefined when no system object is present (e.g. the mapped
 * {@link FoundryActor} produced by the socket world-cache path).
 */
function systemOf(obj: unknown): Record<string, unknown> | undefined {
  if (isRecord(obj) && isRecord(obj.system)) {
    return obj.system;
  }
  return undefined;
}

function extractNested(obj: Record<string, unknown>, ...keys: string[]): unknown {
  let current: unknown = obj;
  for (const key of keys) {
    if (isRecord(current) && key in current) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Extracts a string from nested Record, following a chain of keys.
 */
function extractString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  const val = extractNested(obj, ...keys);
  return typeof val === 'string' ? val : null;
}

// ============================================================================
// Attribute-patch helpers (#143)
// ============================================================================

/**
 * Reads a dot-path out of a nested Record tree, returning undefined if any
 * segment is missing.
 */
function getDotPath(obj: Record<string, unknown>, path: string): unknown {
  return extractNested(obj, ...path.split('.'));
}

/**
 * Reads the actor's game-system id from raw world data, when available.
 * Used to pick the exhaustion clamp (2024 dnd5e: 0–10; 2014: 0–6).
 */
function exhaustionMax(sys: Record<string, unknown> | undefined): number {
  // dnd5e 2024 rules cap exhaustion at 10; the 2014 rules cap it at 6.
  // Without an explicit rules-version signal, default to the wider 2024 range
  // so legitimate 2024 values are not rejected; the 2014 cap is applied when
  // the actor's system data exposes a `rules: "2014"`-style marker.
  if (isRecord(sys)) {
    const source = isRecord(sys._source) ? sys._source : undefined;
    const rules =
      extractString(sys, 'rules') ||
      (source ? extractString(source, 'rules') : null) ||
      extractString(sys, 'attributes', 'exhaustion', 'rules');
    if (rules === '2014' || rules === 'legacy') {
      return 6;
    }
  }
  return 10;
}

/**
 * Validates an attribute patch against the actor's current data, throwing a
 * clear error on the first violation. Only checks rules for which the needed
 * limit (max HP, slot max, exhaustion bound) is available.
 */
function validateAttributePatch(
  patch: AttributePatch,
  actor: FoundryActor,
  rawSystem: Record<string, unknown> | undefined,
): void {
  // Prefer the raw `system` document for bounds: in REST mode getActor returns
  // the raw document (HP at system.attributes.hp.{value,max,temp}); the mapped
  // FoundryActor.hp is only populated on the socket world-cache path.
  const rawHp = rawSystem ? extractNested(rawSystem, 'attributes', 'hp') : undefined;
  const hp = isRecord(rawHp) ? rawHp : undefined;

  for (const [path, value] of Object.entries(patch)) {
    // HP value cannot exceed max + temp.
    if (path === 'attributes.hp.value' && typeof value === 'number') {
      const patchedTemp = patch['attributes.hp.temp'];
      const currentTemp = typeof hp?.temp === 'number' ? hp.temp : (actor.hp?.temp ?? 0);
      const temp = typeof patchedTemp === 'number' ? patchedTemp : currentTemp;
      const max = typeof hp?.max === 'number' ? hp.max : actor.hp?.max;
      if (typeof max === 'number' && value > max + temp) {
        throw new Error(
          `Invalid HP value ${value}: exceeds max + temp (${max} + ${temp} = ${max + temp})`,
        );
      }
    }

    // Spell-slot value cannot exceed its max.
    const slotMatch = /^spells\.(spell\w+|pact)\.value$/.exec(path);
    const slotKey = slotMatch?.[1];
    if (slotKey && typeof value === 'number' && rawSystem) {
      const slotMax = extractNested(rawSystem, 'spells', slotKey, 'max');
      if (typeof slotMax === 'number' && value > slotMax) {
        throw new Error(
          `Invalid spell slot value ${value} for ${slotKey}: exceeds max (${slotMax})`,
        );
      }
    }

    // Exhaustion clamped 0–10 (2024) or 0–6 (2014).
    if (path === 'attributes.exhaustion' && typeof value === 'number') {
      const max = exhaustionMax(rawSystem);
      if (value < 0 || value > max) {
        throw new Error(`Invalid exhaustion ${value}: must be between 0 and ${max}`);
      }
    }
  }
}

/**
 * Overlays the bridge's prepared (derived) values on a Socket.IO actor: AC,
 * max HP and save totals, which dnd5e computes in a browser client's
 * `prepareData` and the Socket.IO source data lacks (#308). Everything else
 * stays as Socket.IO reported it. A value the bridge reports as absent leaves
 * the Socket.IO value (or its "not available" label) in place.
 */
export function overlayDerivedValues(base: FoundryActor, prepared: FoundryActor): FoundryActor {
  const actor: FoundryActor = { ...base };
  let unavailable = base.derivedUnavailable ?? [];

  if (prepared.ac) {
    actor.ac = { ...prepared.ac };
    unavailable = unavailable.filter((field) => field !== 'ac');
  }
  if (typeof prepared.hp?.max === 'number') {
    actor.hp = { ...base.hp, max: prepared.hp.max };
    unavailable = unavailable.filter((field) => field !== 'hpMax');
  }
  if (base.abilities && prepared.abilities) {
    const abilities: NonNullable<FoundryActor['abilities']> = {};
    for (const [key, ability] of Object.entries(base.abilities)) {
      const save = prepared.abilities[key]?.save;
      abilities[key] = typeof save === 'number' ? { ...ability, save } : ability;
    }
    actor.abilities = abilities;
  }

  if (unavailable.length > 0) {
    actor.derivedUnavailable = unavailable;
  } else {
    delete actor.derivedUnavailable;
  }
  return actor;
}

/** Which capability a diagnostics REST path serves, for the log-once bookkeeping. */
function capabilityOfRestPath(url: string): Capability {
  return url.startsWith('/api/diagnostics/health') ? 'system-health' : 'logs';
}

/**
 * One line for the log and the health report: the HTTP status, error code or
 * message, never the request config (it carries the API key header).
 */
function restErrorSummary(error: unknown): string {
  if (error instanceof RestKeyRejectedError) {
    return error.message;
  }
  const status = restStatusOf(error);
  if (status !== undefined) {
    const message = restBodyMessage(error);
    return message === undefined ? `HTTP ${status}` : `HTTP ${status}: ${message}`;
  }
  const { code } = describeRestFailure(error);
  const message = error instanceof Error ? error.message : String(error);
  return code !== undefined && !message.includes(code) ? `${code}: ${message}` : message;
}
