/**
 * Per-capability source selection: the one table that says which source can
 * serve each kind of data, which one is preferred, and which capabilities each
 * MCP tool depends on.
 *
 * `FoundryClient` reads it to route a read to a source and fall back, and
 * `tools/availability.ts` reads it to decide which tools a mode can offer.
 *
 * Sources:
 * - `socket`: the Socket.IO session — the `worldData` snapshot kept live by
 *   broadcasts, and `modifyDocument` for writes.
 * - `rest`: the REST bridge (foundryvtt-local-rest-api), whose answers come
 *   from a GM browser client running the module, after the game system
 *   prepared its data.
 * - `local`: computed in this process, always available.
 */

import type { TransportMode } from './transport.js';

export type DataSource = 'socket' | 'rest' | 'local';

export type Capability =
  | 'actors'
  | 'actor-derived'
  | 'items'
  | 'scenes'
  | 'world-info'
  | 'world-snapshot'
  | 'dice'
  | 'compendium'
  | 'logs'
  | 'system-health'
  | 'connection-health'
  | 'writes'
  | 'local';

export interface CapabilitySpec {
  /** Sources that can serve the capability, in fallback order after `preferred`. */
  readonly sources: readonly DataSource[];
  /** Tried first whenever the mode has it. */
  readonly preferred: DataSource;
}

export const CAPABILITY_SOURCES: Readonly<Record<Capability, CapabilitySpec>> = {
  /** Base actor data: name, type, HP value, ability scores, class levels. */
  actors: { sources: ['socket', 'rest'], preferred: 'socket' },
  /**
   * Values dnd5e computes in `prepareData` (AC, max HP, save totals). Only a
   * browser client has them, so the bridge is preferred; Socket.IO falls back
   * to what is exact from source data (#309) and labels the rest (#308).
   */
  'actor-derived': { sources: ['rest', 'socket'], preferred: 'rest' },
  items: { sources: ['socket', 'rest'], preferred: 'socket' },
  scenes: { sources: ['socket', 'rest'], preferred: 'socket' },
  'world-info': { sources: ['socket', 'rest'], preferred: 'socket' },
  /** Combat, chat, users, journals, world search and counts: the cached snapshot. */
  'world-snapshot': { sources: ['socket'], preferred: 'socket' },
  /** Foundry's own Roll engine via the bridge, else the local roller. */
  dice: { sources: ['rest', 'local'], preferred: 'rest' },
  compendium: { sources: ['rest'], preferred: 'rest' },
  logs: { sources: ['rest'], preferred: 'rest' },
  'system-health': { sources: ['rest'], preferred: 'rest' },
  /** get_health_status: reports whichever connections exist. */
  'connection-health': { sources: ['socket', 'rest'], preferred: 'socket' },
  /** Mutations and broadcasts: Socket.IO `modifyDocument` only. */
  writes: { sources: ['socket'], preferred: 'socket' },
  local: { sources: ['local'], preferred: 'local' },
};

/**
 * The capabilities each MCP tool depends on. The first entry is the one that
 * decides whether the tool can be offered; later entries are augments it uses
 * when available. A tool missing here is hidden (see availability.ts).
 */
export const TOOL_CAPABILITIES: Readonly<Record<string, readonly Capability[]>> = {
  roll_dice: ['dice'],
  search_actors: ['actors', 'actor-derived'],
  get_actor_details: ['actors', 'actor-derived'],
  search_items: ['items'],
  get_scene_info: ['scenes'],
  generate_npc: ['local'],
  generate_loot: ['local'],
  lookup_rule: ['local'],
  diagnose_errors: ['local'],
  get_health_status: ['connection-health', 'world-info', 'system-health'],

  get_combat_state: ['world-snapshot'],
  get_chat_messages: ['world-snapshot'],
  get_users: ['world-snapshot'],
  search_journals: ['world-snapshot'],
  get_journal: ['world-snapshot'],
  search_world: ['world-snapshot'],
  get_world_summary: ['world-snapshot'],
  refresh_world_data: ['world-snapshot'],

  search_compendium: ['compendium'],
  get_recent_logs: ['logs'],
  search_logs: ['logs'],
  get_system_health: ['system-health'],

  update_actor_attributes: ['writes'],
  create_actor_item: ['writes'],
  update_actor_item: ['writes'],
  delete_actor_item: ['writes'],
  create_journal_entry: ['writes'],
  start_combat: ['writes'],
  next_turn: ['writes'],
  end_combat: ['writes'],
  set_initiative: ['writes'],
  move_token: ['writes'],
  apply_status_effect: ['writes'],
};

const MODE_SOURCES: Readonly<Record<TransportMode, ReadonlySet<DataSource>>> = {
  socket: new Set<DataSource>(['socket', 'local']),
  rest: new Set<DataSource>(['rest', 'local']),
  dual: new Set<DataSource>(['socket', 'rest', 'local']),
};

/** The sources a transport mode has configured. */
export function configuredSources(mode: TransportMode): ReadonlySet<DataSource> {
  return MODE_SOURCES[mode];
}

/**
 * The sources to try for a capability in this mode, preferred first, then the
 * remaining configured sources in table order. Empty when the mode cannot
 * serve the capability at all.
 */
export function sourceOrder(capability: Capability, mode: TransportMode): DataSource[] {
  const { sources, preferred } = CAPABILITY_SOURCES[capability];
  const configured = configuredSources(mode);
  const ordered = [preferred, ...sources.filter((source) => source !== preferred)];
  return ordered.filter((source) => configured.has(source));
}

/** The first source to try for a capability in this mode, if any. */
export function preferredSource(
  capability: Capability,
  mode: TransportMode,
): DataSource | undefined {
  return sourceOrder(capability, mode)[0];
}
