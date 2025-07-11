/**
 * @fileoverview Tool routing and handler coordination
 * 
 * This module routes tool requests to appropriate handlers and manages
 * the coordination between different tool categories.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { FoundryClient } from '../foundry/client.js';
import { DiagnosticsClient } from '../diagnostics/client.js';
import { DiagnosticSystem } from '../utils/diagnostics.js';
import { logger } from '../utils/logger.js';

// Import all tool handlers
import { handleRollDice } from './handlers/dice.js';
import { handleSearchActors, handleGetActorDetails } from './handlers/actors.js';
import { handleSearchItems } from './handlers/items.js';
import { handleGetSceneInfo } from './handlers/scenes.js';
import { handleGenerateNPC, handleGenerateLoot, handleLookupRule } from './handlers/generation.js';
import { 
  handleGetRecentLogs, 
  handleSearchLogs, 
  handleGetSystemHealth,
  handleDiagnoseErrors,
  handleGetHealthStatus 
} from './handlers/diagnostics.js';
import { handleReadResource } from './handlers/resources.js';

/**
 * Routes tool requests to appropriate handlers
 */
export async function routeToolRequest(
  name: string,
  args: Record<string, unknown>,
  foundryClient: FoundryClient,
  diagnosticsClient: DiagnosticsClient,
  diagnosticSystem: DiagnosticSystem
) {
  logger.debug(`Routing tool request: ${name}`, { args });

  switch (name) {
    // Dice tools
    case 'roll_dice':
      return handleRollDice(args, foundryClient);

    // Actor tools
    case 'search_actors':
      return handleSearchActors(args, foundryClient);
    case 'get_actor_details':
      return handleGetActorDetails(args, foundryClient);

    // Item tools
    case 'search_items':
      return handleSearchItems(args, foundryClient);

    // Scene tools
    case 'get_scene_info':
      return handleGetSceneInfo(args, foundryClient);

    // Generation tools
    case 'generate_npc':
      return handleGenerateNPC(args, foundryClient);
    case 'generate_loot':
      return handleGenerateLoot(args, foundryClient);
    case 'lookup_rule':
      return handleLookupRule(args, foundryClient);

    // Diagnostics tools
    case 'get_recent_logs':
      return handleGetRecentLogs(args, diagnosticsClient);
    case 'search_logs':
      return handleSearchLogs(args, diagnosticsClient);
    case 'get_system_health':
      return handleGetSystemHealth(args, diagnosticsClient);
    case 'diagnose_errors':
      return handleDiagnoseErrors(args, diagnosticSystem);
    case 'get_health_status':
      return handleGetHealthStatus(args, foundryClient, diagnosticsClient);

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}

/**
 * Routes resource requests to appropriate handlers
 */
export async function routeResourceRequest(
  uri: string,
  foundryClient: FoundryClient,
  diagnosticsClient: DiagnosticsClient
) {
  logger.debug(`Routing resource request: ${uri}`);
  return handleReadResource(uri, foundryClient, diagnosticsClient);
}