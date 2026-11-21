/**
 * Visibility rules for MCP tools by Foundry transport and write opt-in.
 *
 * Tool discovery reflects the configured transport, not a network health
 * check or a guarantee of Foundry document ownership. Execution retains
 * the normal authorization and live-connection checks.
 *
 * New tool names default to hidden until their transport support is
 * classified here. See the completeness test in availability.test.ts.
 */

import { getAllTools } from './definitions.js';

export type ToolTransport = 'socket' | 'rest';

export interface ToolAvailability {
  transport: ToolTransport;
  writeEnabled: boolean;
}

type ToolAccess = 'shared' | 'socket' | 'rest' | 'socket-write';

/**
 * Shared: callable on both transports (some functions run locally).
 * Socket: depends on the cached Socket.IO world snapshot.
 * REST: depends on Foundry Local REST API module endpoints.
 * Socket-write: also needs FOUNDRY_WRITE_ENABLED=true; Foundry checks permissions.
 *
 * get_health_status provides partial diagnostics without REST.
 * lookup_rule and diagnose_errors are existing placeholders; their descriptions
 * disclose that limitation. This change does not alter their implementation.
 */
const TOOL_ACCESS: Readonly<Record<string, ToolAccess>> = {
  roll_dice: 'shared',
  search_actors: 'shared',
  get_actor_details: 'shared',
  search_items: 'shared',
  get_scene_info: 'shared',
  generate_npc: 'shared',
  generate_loot: 'shared',
  lookup_rule: 'shared',
  diagnose_errors: 'shared',
  get_health_status: 'shared',

  get_combat_state: 'socket',
  get_chat_messages: 'socket',
  get_users: 'socket',
  search_journals: 'socket',
  get_journal: 'socket',
  search_world: 'socket',
  get_world_summary: 'socket',
  refresh_world_data: 'socket',

  search_compendium: 'rest',
  get_recent_logs: 'rest',
  search_logs: 'rest',
  get_system_health: 'rest',

  update_actor_attributes: 'socket-write',
  create_actor_item: 'socket-write',
  update_actor_item: 'socket-write',
  delete_actor_item: 'socket-write',
  create_journal_entry: 'socket-write',
  start_combat: 'socket-write',
  next_turn: 'socket-write',
  end_combat: 'socket-write',
  set_initiative: 'socket-write',
  move_token: 'socket-write',
  apply_status_effect: 'socket-write',
};

/** Whether a tool belongs in tools/list and can be dispatched in this mode. */
export function isToolAvailable(name: string, availability: ToolAvailability): boolean {
  switch (TOOL_ACCESS[name]) {
    case 'shared':
      return true;
    case 'socket':
      return availability.transport === 'socket';
    case 'rest':
      return availability.transport === 'rest';
    case 'socket-write':
      return availability.transport === 'socket' && availability.writeEnabled;
    default:
      // Fail closed when a tool is added without an availability classification.
      return false;
  }
}

/**
 * Outcome of the CallTool gate for a single tool name.
 *
 * - `available`: the tool may be dispatched in this mode.
 * - `unknown`: the name is not in the availability table; let the router
 *   produce its own `MethodNotFound` ("Unknown tool") error.
 * - `blocked`: the tool exists but is unavailable here; `reason` names the
 *   actual cause (writes disabled, REST mode, Socket.IO mode).
 */
export type ToolGateResult =
  | { readonly status: 'available' }
  | { readonly status: 'unknown' }
  | { readonly status: 'blocked'; readonly reason: string };

/**
 * Decide whether a CallTool request for `name` may proceed in this mode, and
 * name the reason when it may not. Names absent from the table return
 * `unknown` so the router keeps its "Unknown tool" error rather than the gate
 * masking an unregistered name as "unavailable".
 */
export function checkToolAvailability(
  name: string,
  availability: ToolAvailability,
): ToolGateResult {
  const access = TOOL_ACCESS[name];
  if (access === undefined) {
    return { status: 'unknown' };
  }
  if (access === 'shared') {
    return { status: 'available' };
  }
  if (access === 'socket') {
    return availability.transport === 'socket'
      ? { status: 'available' }
      : {
          status: 'blocked',
          reason: `Tool "${name}" requires the Socket.IO transport and is unavailable in REST mode.`,
        };
  }
  if (access === 'rest') {
    return availability.transport === 'rest'
      ? { status: 'available' }
      : {
          status: 'blocked',
          reason: `Tool "${name}" requires the REST API module (FOUNDRY_API_KEY) and is unavailable in Socket.IO mode.`,
        };
  }
  // socket-write: needs the Socket.IO transport, and the write opt-in on top.
  if (availability.transport !== 'socket') {
    return {
      status: 'blocked',
      reason: `Tool "${name}" is a write tool; write tools require the Socket.IO transport and are unavailable in REST mode.`,
    };
  }
  if (!availability.writeEnabled) {
    return {
      status: 'blocked',
      reason: `Tool "${name}" is a write tool. Set FOUNDRY_WRITE_ENABLED=true to enable game-state mutations.`,
    };
  }
  return { status: 'available' };
}

/** The tools that the configured MCP server can meaningfully offer. */
export function getAvailableTools(availability: ToolAvailability): ReturnType<typeof getAllTools> {
  return getAllTools().filter((tool) => isToolAvailable(tool.name, availability));
}
