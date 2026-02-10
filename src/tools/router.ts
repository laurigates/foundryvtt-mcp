/**
 * Tool routing and handler coordination
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { FoundryClient } from '../foundry/client.js';
import { DiagnosticsClient } from '../diagnostics/client.js';
import { DiagnosticSystem } from '../utils/diagnostics.js';
import { logger } from '../utils/logger.js';
import { toolRegistry } from './registry.js';
import { ToolContext } from './base.js';

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
import { handleGetCombatState } from './handlers/combat.js';
import { handleGetChatMessages } from './handlers/chat.js';
import { handleGetUsers } from './handlers/users.js';
import { handleSearchJournals, handleGetJournal } from './handlers/journals.js';
import { handleSearchWorld, handleGetWorldSummary, handleRefreshWorldData } from './handlers/world.js';

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

  // Try the new registry system first
  if (toolRegistry.has(name)) {
    const context: ToolContext = {
      foundryClient,
      diagnosticsClient,
      diagnosticSystem,
    };

    try {
      return await toolRegistry.execute(name, args, context);
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  switch (name) {
    // Dice tools
    case 'roll_dice':
      if (!('formula' in args) || typeof args.formula !== 'string') {
        throw new Error('Missing required parameter: formula');
      }
      return handleRollDice(args as { formula: string; reason?: string }, foundryClient);

    // Actor tools
    case 'search_actors':
      return handleSearchActors(args, foundryClient);
    case 'get_actor_details':
      if (!('actorId' in args) || typeof args.actorId !== 'string') {
        throw new Error('Missing required parameter: actorId');
      }
      return handleGetActorDetails(args as { actorId: string }, foundryClient);

    // Item tools
    case 'search_items':
      return handleSearchItems(args, foundryClient);

    // Scene tools
    case 'get_scene_info':
      return handleGetSceneInfo(args, foundryClient);

    // Combat tools
    case 'get_combat_state':
      return handleGetCombatState(args, foundryClient);

    // Chat tools
    case 'get_chat_messages':
      return handleGetChatMessages(args as { limit?: number }, foundryClient);

    // User tools
    case 'get_users':
      return handleGetUsers(args, foundryClient);

    // Journal tools
    case 'search_journals':
      if (!('query' in args) || typeof args.query !== 'string') {
        throw new Error('Missing required parameter: query');
      }
      return handleSearchJournals(args as { query: string; limit?: number }, foundryClient);
    case 'get_journal':
      if (!('journalId' in args) || typeof args.journalId !== 'string') {
        throw new Error('Missing required parameter: journalId');
      }
      return handleGetJournal(args as { journalId: string }, foundryClient);

    // World tools
    case 'search_world':
      if (!('query' in args) || typeof args.query !== 'string') {
        throw new Error('Missing required parameter: query');
      }
      return handleSearchWorld(args as { query: string; limit?: number }, foundryClient);
    case 'get_world_summary':
      return handleGetWorldSummary(args, foundryClient);
    case 'refresh_world_data':
      return handleRefreshWorldData(args, foundryClient);

    // Generation tools
    case 'generate_npc':
      return handleGenerateNPC(args as { level?: number; race?: string; class?: string }, foundryClient);
    case 'generate_loot':
      return handleGenerateLoot(args as { challengeRating?: number; treasureType?: string }, foundryClient);
    case 'lookup_rule':
      if (!('query' in args) || typeof args.query !== 'string') {
        throw new Error('Missing required parameter: query');
      }
      return handleLookupRule(args as { query: string; system?: string }, foundryClient);

    // Diagnostics tools (require REST API module)
    case 'get_recent_logs':
      return handleGetRecentLogs(args, diagnosticsClient);
    case 'search_logs':
      if (!('query' in args) || typeof args.query !== 'string') {
        throw new Error('Missing required parameter: query');
      }
      return handleSearchLogs(args as { query: string; level?: string; limit?: number }, diagnosticsClient);
    case 'get_system_health':
      return handleGetSystemHealth(args, diagnosticsClient);
    case 'diagnose_errors':
      return handleDiagnoseErrors(args as { category?: string }, diagnosticSystem);
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
