/**
 * Visibility rules for MCP tools by Foundry transport and write opt-in.
 *
 * Tool discovery reflects the configured transport, not a network health
 * check or a guarantee of Foundry document ownership. Execution retains
 * the normal authorization and live-connection checks. In dual mode a tool
 * served by the REST bridge stays listed while the bridge is down; the call
 * then degrades (see `FoundryClient`), and no Socket.IO tool is ever hidden
 * because of the bridge.
 *
 * Which sources serve which tool lives in one table,
 * `TOOL_CAPABILITIES`/`CAPABILITY_SOURCES` in `foundry/capabilities.ts`: a
 * tool is offered when the mode configures at least one source for its first
 * (primary) capability, and write tools also need FOUNDRY_WRITE_ENABLED=true.
 *
 * New tool names default to hidden until they are classified there. See the
 * completeness test in availability.test.ts.
 */

import { sourceOrder, TOOL_CAPABILITIES } from '../foundry/capabilities.js';
import type { TransportMode } from '../foundry/transport.js';
import { getAllTools } from './definitions.js';

export type ToolTransport = TransportMode;

export interface ToolAvailability {
  transport: ToolTransport;
  writeEnabled: boolean;
}

/**
 * Outcome of the CallTool gate for a single tool name.
 *
 * - `available`: the tool may be dispatched in this mode.
 * - `unknown`: the name is not in the capability table; let the router
 *   produce its own `MethodNotFound` ("Unknown tool") error.
 * - `blocked`: the tool exists but is unavailable here; `reason` names the
 *   actual cause (writes disabled, REST-only mode, no REST bridge).
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
  const primary = TOOL_CAPABILITIES[name]?.[0];
  if (primary === undefined) {
    return { status: 'unknown' };
  }
  const servable = sourceOrder(primary, availability.transport).length > 0;

  if (primary === 'writes') {
    if (!servable) {
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

  if (servable) {
    return { status: 'available' };
  }
  if (availability.transport === 'rest') {
    return {
      status: 'blocked',
      reason: `Tool "${name}" requires the Socket.IO transport and is unavailable in REST mode.`,
    };
  }
  return {
    status: 'blocked',
    reason: `Tool "${name}" requires the REST bridge (FOUNDRY_API_KEY with FOUNDRY_REST_URL) and is unavailable in Socket.IO mode.`,
  };
}

/** Whether a tool belongs in tools/list and can be dispatched in this mode. */
export function isToolAvailable(name: string, availability: ToolAvailability): boolean {
  // Fail closed when a tool is added without a capability classification.
  return checkToolAvailability(name, availability).status === 'available';
}

/** The tools that the configured MCP server can meaningfully offer. */
export function getAvailableTools(availability: ToolAvailability): ReturnType<typeof getAllTools> {
  return getAllTools().filter((tool) => isToolAvailable(tool.name, availability));
}
