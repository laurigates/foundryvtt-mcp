/** Transport-independent provider contracts. Every instance belongs to one target session. */
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { Capability } from '../foundry/capabilities.js';
import type { TransportMode } from '../foundry/transport.js';
import type {
  ActorAttributeUpdateResult,
  ActorItemCreateSource,
  ActorSearchResult,
  CompendiumSearchResult,
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
  WorldJournal,
  WorldMessage,
  WorldScene,
  WorldUser,
} from '../foundry/types.js';
import type { WorldSearchResults } from '../foundry/world-search.js';

/** Outcome of the last REST request; for the historical REST bridge. */
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

export interface FoundryClientConfig {
  baseUrl: string;
  apiKey?: string;
  /** Optional historical bridge endpoint; explicit targets use restApiKey. */
  restUrl?: string;
  username?: string;
  password?: string;
  userId?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  socketPath?: string;
  writeEnabled?: boolean;
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
  cursor?: string;
}
export type AttributePatch = Record<string, number | string | boolean>;

/** The core document port. Handlers depend on this interface, never on a transport class. */
export interface FoundryCore {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  isWorldDataStale(): boolean;
  hasWorldData(): boolean;
  refreshWorldData(): Promise<void>;
  getWorldData(): WorldData | null;
  searchActors(params: SearchActorsParams): Promise<ActorSearchResult>;
  getActor(actorId: string): Promise<FoundryActor>;
  getRawActor(actorId: string): WorldActor | undefined;
  updateActorAttribute(actorId: string, patch: AttributePatch): Promise<ActorAttributeUpdateResult>;
  searchItems(params: SearchItemsParams): Promise<ItemSearchResult>;
  searchCompendium(params: CompendiumSearchParams): Promise<CompendiumSearchResult>;
  createActorItem(actorId: string, source: ActorItemCreateSource): Promise<FoundryItem>;
  updateActorItem(
    actorId: string,
    itemId: string,
    patch: Record<string, unknown>,
  ): Promise<FoundryItem>;
  deleteActorItem(actorId: string, itemId: string): Promise<void>;
  updateCombat(combatId: string, patch: { turn?: number; round?: number }): Promise<unknown>;
  endCombat(combatId: string): Promise<void>;
  setCombatantInitiative(
    combatId: string,
    combatantId: string,
    initiative: number,
  ): Promise<unknown>;
  startCombat(
    sceneId: string,
    combatants: Array<{ tokenId: string; sceneId: string; actorId?: string | undefined }>,
  ): Promise<{ combatId: string; combatantCount: number }>;
  findToken(
    tokenId: string,
    sceneId?: string,
  ): { scene: WorldScene; token: Record<string, unknown> } | null;
  moveToken(sceneId: string, tokenId: string, x: number, y: number): Promise<unknown>;
  createActorStatusEffect(parentActorUuid: string, statusId: string): Promise<WorldEffect>;
  deleteActorEffect(parentActorUuid: string, effectId: string): Promise<void>;
  getCurrentScene(sceneId?: string): Promise<FoundryScene>;
  getScene(sceneId: string): Promise<FoundryScene>;
  getScenes(): WorldScene[];
  getWorldInfo(): Promise<FoundryWorld>;
  getCombatState(): WorldCombat | null;
  getChatMessages(limit?: number): WorldMessage[];
  getUsers(): { users: WorldUser[]; activeUsers: string[] };
  getJournals(): WorldJournal[];
  searchJournals(query: string): WorldJournal[];
  getJournal(journalId: string): WorldJournal | undefined;
  createJournalEntry(
    name: string,
    pages: JournalPageCreateSource[],
    folder?: string,
    visibility?: DocumentVisibility,
  ): Promise<WorldJournal>;
  searchWorld(query: string): WorldSearchResults;
  getWorldSummary(): Record<string, number>;
  rollDice(formula: string, reason?: string): Promise<DiceRoll>;
  testConnection(): Promise<boolean>;
  getTransportMode?(): TransportMode;
  getConnectionReport?(): ConnectionReport;
  getTransportWarnings?(): readonly string[];
  requestRestDiagnostics?<T = unknown>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>>;
  /** Historical diagnostics HTTP port; providers lacking diagnostics.read reject it. */
  get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
}

export interface FoundryEnvironment {
  world: { id: string; title: string };
  system: { id: string; version: string };
  foundryVersion: string;
  modules: Array<{ id: string; title: string; version: string; active: boolean }>;
  ready: boolean;
  userId?: string;
  origin?: string;
  /** When composition uses different authenticated clients, both identities are reported. */
  coreUserId?: string;
}
export type ProviderKind = 'socketio' | 'legacy-rest' | 'rest-api' | 'composite';
export interface FoundryProvider extends FoundryCore {
  readonly kind: ProviderKind;
  readonly capabilities: ReadonlySet<string>;
  inspect(): Promise<FoundryEnvironment>;
  /** Execute a repository-owned binding. This is never exposed as a free-form MCP tool. */
  execute(
    script: string,
    args: Record<string, unknown>,
    options: { readOnly: boolean },
  ): Promise<unknown>;
  /** Changes whenever a connection is replaced or its transport disconnects/reconnects. */
  getGeneration(): number;
}
export interface SocketIOProviderConfig extends Omit<FoundryClientConfig, 'apiKey'> {
  kind: 'socketio';
  /** Separate, explicit key for the optional historical REST bridge. */
  restApiKey?: string;
}
export interface LegacyRestProviderConfig extends FoundryClientConfig {
  kind: 'legacy-rest';
  apiKey: string;
}
export interface RestApiProviderConfig {
  kind: 'rest-api';
  relayUrl: string;
  apiKey: string;
  clientId: string;
  executeJsPath?: string;
  timeout?: number;
  writeEnabled?: boolean;
  expectedWorldId?: string;
  expectedOrigin?: string;
}
export interface CompositeProviderConfig {
  kind: 'composite';
  core: SocketIOProviderConfig;
  execution: RestApiProviderConfig;
}
export type ProviderConfig =
  | SocketIOProviderConfig
  | LegacyRestProviderConfig
  | RestApiProviderConfig
  | CompositeProviderConfig;
