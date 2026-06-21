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
import { authenticateFoundry } from './auth.js';
import type {
  ActorAttributeUpdateResult,
  ActorItemCreateSource,
  ActorSearchResult,
  CompendiumSearchResult,
  DiceRoll,
  FoundryActor,
  FoundryItem,
  FoundryScene,
  FoundryWorld,
  ItemSearchResult,
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

/** FoundryVTT document IDs are 16-character alphanumeric strings. */
const FOUNDRY_ID_PATTERN = /^[a-zA-Z0-9]{16}$/;

/**
 * Accepts the two parent-UUID forms a token's actor can take:
 *  - `Actor.<id>` — a world-linked actor (`actorLink: true`)
 *  - `Scene.<sid>.Token.<tid>.Actor.<aid>` — an unlinked token's synthetic actor
 */
const TOKEN_ACTOR_UUID_PATTERN =
  /^(Actor\.[a-zA-Z0-9]{16}|Scene\.[a-zA-Z0-9]{16}\.Token\.[a-zA-Z0-9]{16}\.Actor\.[a-zA-Z0-9]{16})$/;

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

/** Minimal shape of FoundryVTT's `modifyDocument` Socket.IO acknowledgement. */
interface DocumentSocketResponse {
  /** Created/updated data objects, or deleted ids, on success. */
  result?: unknown[];
  /** Present when the server rejects the operation. */
  error?: { message?: string } | null;
  userId?: string;
}

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

    if (this.config.apiKey) {
      this.http.interceptors.request.use((reqConfig) => {
        reqConfig.headers['x-api-key'] = this.config.apiKey;
        return reqConfig;
      });
    }

    const mode = this.config.apiKey ? 'REST API' : 'Socket.IO';
    logger.info(`FoundryVTT client initialized (${mode} mode)`);
  }

  /**
   * Connects to FoundryVTT.
   * REST API mode: tests /api/status endpoint.
   * Socket.IO mode: authenticates and loads full worldData.
   */
  async connect(): Promise<void> {
    if (this.config.apiKey) {
      try {
        await this.http.get('/api/status');
        this._isConnected = true;
        logger.info('Connected to FoundryVTT via REST API module');
      } catch (error) {
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

    const { session } = await authenticateFoundry(this.config.baseUrl, user, this.config.password);

    // Connect authenticated socket and load world data
    this.worldData = await this.connectAndLoadWorld(session);
    this._isConnected = true;
    logger.info('Connected to FoundryVTT via Socket.IO', {
      actors: this.worldData.actors.length,
      scenes: this.worldData.scenes.length,
      items: this.worldData.items.length,
    });
  }

  /**
   * Connects Socket.IO with an authenticated session and loads worldData.
   */
  private connectAndLoadWorld(session: string): Promise<WorldData> {
    return new Promise((resolve, reject) => {
      this.socket = io(this.config.baseUrl, {
        transports: ['websocket'],
        query: { session },
      });

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

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.worldData = null;
    this._isConnected = false;
    logger.info('FoundryVTT client disconnected');
  }

  isConnected(): boolean {
    return this._isConnected;
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

  async searchActors(params: SearchActorsParams): Promise<ActorSearchResult> {
    if (this.config.apiKey) {
      return this.executeWithRetry(async () => {
        const response = await this.http.get('/api/actors', { params });
        return response.data;
      });
    }

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
    if (this.config.apiKey) {
      return this.executeWithRetry(async () => {
        const response = await this.http.get(`/api/actors/${actorId}`);
        return response.data;
      });
    }

    if (!this.worldData) {
      throw new Error('Not connected — no world data available');
    }

    const actor = this.worldData.actors.find((a) => a._id === actorId);
    if (!actor) {
      throw new Error(`Actor not found: ${actorId}`);
    }

    return worldActorToFoundry(actor);
  }

  /**
   * Returns the raw WorldActor with the full system data (game-system specific).
   */
  getRawActor(actorId: string): WorldActor | undefined {
    return this.worldData?.actors.find((a) => a._id === actorId);
  }

  /**
   * Patches attributes on an actor's `system` object (#143). WRITE — REST required.
   *
   * `patch` keys are dot-paths into `actor.system` (e.g. `attributes.hp.value`,
   * `currency.gp`, `spells.spell1.value`, `attributes.exhaustion`). The patch is
   * expanded into a nested object and sent as `PUT /api/actors/:actorId` with the
   * body `{ system: <expanded patch> }` — matching FoundryVTT's own document model
   * (`Actor#update`).
   *
   * Client-side validation, using the actor's current data, rejects:
   *  - HP value exceeding `max + temp`,
   *  - spell-slot value exceeding its `max`,
   *  - exhaustion outside `0–10` (2024 rules) or `0–6` (2014 rules).
   *
   * @throws if `apiKey` is unset, the id is malformed, the actor/path is missing,
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
    if (this.config.apiKey) {
      return this.executeWithRetry(async () => {
        const response = await this.http.get('/api/items', { params });
        return response.data;
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
    const items = results.slice(0, limit).map((i) => {
      const item: {
        _id: string;
        name: string;
        type: string;
        img?: string;
        description?: string;
        rarity?: string;
      } = {
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
    });

    return { items, total, page: 1, limit };
  }

  // ==========================================================================
  // Compendium methods
  // ==========================================================================

  /**
   * Searches FoundryVTT compendium packs by name and metadata.
   *
   * Compendium data is not present in the cached worldData snapshot, so this
   * read requires the REST API module (FOUNDRY_API_KEY). When the key is
   * absent it returns a graceful empty result with `restAvailable: false`
   * rather than throwing, mirroring the no-worldData behaviour of
   * {@link searchItems}/{@link searchActors}; the handler surfaces a note
   * explaining why no results were returned.
   */
  async searchCompendium(params: CompendiumSearchParams): Promise<CompendiumSearchResult> {
    const limit = params.limit ?? 20;
    const offset = decodeCursor(params.cursor);

    if (this.config.apiKey) {
      return this.executeWithRetry(async () => {
        // Translate the opaque cursor into a wire offset for the bridge.
        const { cursor: _cursor, ...rest } = params;
        const response = await this.http.get('/api/compendium/search', {
          params: { ...rest, limit, offset },
        });
        const data = (
          isRecord(response.data) ? response.data : {}
        ) as Partial<CompendiumSearchResult>;
        const results = data.results ?? [];
        const total = typeof data.total === 'number' ? data.total : results.length;
        const nextOffset = offset + results.length;
        return {
          results,
          total,
          page: Math.floor(offset / limit) + 1,
          limit,
          restAvailable: true,
          nextCursor: nextOffset < total ? encodeCursor(nextOffset) : null,
        };
      });
    }
    return { results: [], total: 0, page: 1, limit, restAvailable: false, nextCursor: null };
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
   * v13.348 client source (`client/data/client-backend.mjs` `#buildRequest`,
   * `helpers/socket-interface.mjs` `dispatch`, `common/abstract/socket.mjs`).
   *
   * @param type - Document name ("Actor", "Item", …)
   * @param action - "create" | "update" | "delete"
   * @param operation - action-specific payload: `data` (create) / `updates`
   *   (update) / `ids` (delete), plus `parentUuid` for embedded documents.
   * @returns the server's `result` array (created/updated data, or deleted ids)
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
    const response = await this.emitWithAck<DocumentSocketResponse>('modifyDocument', request);
    if (response?.error) {
      throw new Error(
        `FoundryVTT rejected ${action} ${type}: ${response.error.message || 'unknown error'}`,
      );
    }
    return Array.isArray(response?.result) ? response.result : [];
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
   * wire shape is verified against the v13.348 client source per
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
    if (this.config.apiKey) {
      return this.executeWithRetry(async () => {
        const endpoint = sceneId ? `/api/scenes/${sceneId}` : '/api/scenes/current';
        const response = await this.http.get(endpoint);
        return response.data;
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
    if (this.config.apiKey) {
      return this.executeWithRetry(async () => {
        const response = await this.http.get('/api/world');
        return response.data;
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

    const w = this.worldData.world as Record<string, unknown>;
    const s = this.worldData.system as Record<string, unknown>;
    const r = this.worldData.release as Record<string, unknown>;

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
  // Cross-collection search
  // ==========================================================================

  searchWorld(query: string): {
    actors: WorldActor[];
    items: WorldItem[];
    scenes: WorldScene[];
    journals: WorldJournal[];
  } {
    if (!this.worldData) {
      return { actors: [], items: [], scenes: [], journals: [] };
    }

    const q = query.toLowerCase();

    return {
      actors: this.worldData.actors.filter((a) => a.name.toLowerCase().includes(q)),
      items: this.worldData.items.filter((i) => i.name.toLowerCase().includes(q)),
      scenes: this.worldData.scenes.filter((s) => s.name.toLowerCase().includes(q)),
      journals: this.worldData.journal.filter((j) => j.name.toLowerCase().includes(q)),
    };
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

  async rollDice(formula: string, reason?: string): Promise<DiceRoll> {
    const DICE_FORMULA_REGEX = /^[0-9d\s+\-()]+$/;
    if (!formula || formula.length > 100 || !DICE_FORMULA_REGEX.test(formula)) {
      throw new Error(`Invalid dice formula: ${formula}`);
    }

    if (this.config.apiKey) {
      try {
        const response = await this.http.post('/api/dice/roll', {
          formula,
          flavor: reason,
        });

        const result: DiceRoll = {
          formula,
          total: response.data.total,
          breakdown:
            response.data.terms
              ?.map((term: { results?: number[] }) => term.results?.join(', '))
              .join(' + ') || formula,
          timestamp: new Date().toISOString(),
        };
        if (reason) {
          result.reason = reason;
        }
        return result;
      } catch {
        // Fall through to local roll
      }
    }

    return this.fallbackDiceRoll(formula, reason);
  }

  private fallbackDiceRoll(formula: string, reason?: string): DiceRoll {
    const diceRegex = /(\d+)d(\d+)([+-]\d+)?/g;
    let total = 0;
    const breakdown: string[] = [];

    let match: RegExpExecArray | null = diceRegex.exec(formula);
    while (match !== null) {
      const [, numDice, numSides, modifier] = match;
      const diceCount = parseInt(numDice || '1', 10);
      const sides = parseInt(numSides || '6', 10);
      const mod = modifier ? parseInt(modifier, 10) : 0;

      const rolls: number[] = [];
      for (let i = 0; i < diceCount; i++) {
        rolls.push(Math.floor(Math.random() * sides) + 1);
      }

      const rollSum = rolls.reduce((sum, roll) => sum + roll, 0) + mod;
      total += rollSum;
      breakdown.push(`${rolls.join(', ')}${mod !== 0 ? ` ${modifier}` : ''} = ${rollSum}`);
      match = diceRegex.exec(formula);
    }

    const result: DiceRoll = {
      formula,
      total,
      breakdown: breakdown.join(' | '),
      timestamp: new Date().toISOString(),
    };
    if (reason) {
      result.reason = reason;
    }
    return result;
  }

  // ==========================================================================
  // Connection test
  // ==========================================================================

  async testConnection(): Promise<boolean> {
    try {
      if (this.config.username && this.config.password) {
        await this.connect();
        return true;
      }

      const response = await this.http.get('/');
      logger.debug('Connection test successful', { status: response.status });
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

  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(() => this.http.get(url, config));
  }

  async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(() => this.http.post(url, data, config));
  }

  async put<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(() => this.http.put(url, data, config));
  }

  async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(() => this.http.delete(url, config));
  }
}

// ============================================================================
// Mapping helpers — WorldData raw documents → display interfaces
// ============================================================================

function worldActorToFoundry(a: WorldActor): FoundryActor {
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
        const entry: { value: number; mod: number; save?: number } = {
          value: typeof val.value === 'number' ? val.value : 10,
          mod: typeof val.mod === 'number' ? val.mod : 0,
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
    const hpValue = typeof hp.value === 'number' ? hp.value : 0;
    const hpMax = typeof hp.max === 'number' ? hp.max : 0;
    const hpObj: { value: number; max: number; temp?: number } = { value: hpValue, max: hpMax };
    if (typeof hp.temp === 'number') {
      hpObj.temp = hp.temp;
    }
    actor.hp = hpObj;
  }

  if (ac && typeof ac.value === 'number') {
    actor.ac = { value: ac.value };
  }

  if (typeof details.level === 'number') {
    actor.level = details.level;
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

/**
 * Compendium pagination cursors are opaque base64-encoded result offsets.
 * `encodeCursor` turns an offset into a cursor; `decodeCursor` reads it back,
 * returning 0 when the cursor is absent or malformed.
 */
function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64');
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  const decoded = Number.parseInt(Buffer.from(cursor, 'base64').toString('utf8'), 10);
  return Number.isFinite(decoded) && decoded >= 0 ? decoded : 0;
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
