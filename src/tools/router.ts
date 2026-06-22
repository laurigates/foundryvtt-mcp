/**
 * Tool routing and handler coordination
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { DiagnosticsClient } from '../diagnostics/client.js';
import type { AttributePatch, FoundryClient } from '../foundry/client.js';
import type { ActorItemCreateSource } from '../foundry/types.js';
import type { DiagnosticSystem } from '../utils/diagnostics.js';
import { logger } from '../utils/logger.js';
import type { ToolContext, ToolResult } from './base.js';
import { handleUpdateActorAttribute } from './handlers/actor-mutations.js';
import { handleGetActorDetails, handleSearchActors } from './handlers/actors.js';
import { handleGetChatMessages } from './handlers/chat.js';
import { handleGetCombatState } from './handlers/combat.js';
import {
  handleEndCombat,
  handleNextTurn,
  handleSetInitiative,
} from './handlers/combat-mutations.js';
import { handleSearchCompendium } from './handlers/compendium.js';
import {
  handleDiagnoseErrors,
  handleGetHealthStatus,
  handleGetRecentLogs,
  handleGetSystemHealth,
  handleSearchLogs,
} from './handlers/diagnostics.js';
// Import all tool handlers
import { handleRollDice } from './handlers/dice.js';
import { handleGenerateLoot, handleGenerateNPC, handleLookupRule } from './handlers/generation.js';
import {
  handleCreateActorItem,
  handleDeleteActorItem,
  handleUpdateActorItem,
} from './handlers/item-mutations.js';
import { handleSearchItems } from './handlers/items.js';
import { handleGetJournal, handleSearchJournals } from './handlers/journals.js';
import { handleReadResource } from './handlers/resources.js';
import { handleGetSceneInfo } from './handlers/scenes.js';
import { handleApplyStatusEffect, handleMoveToken } from './handlers/token-mutations.js';
import { handleGetUsers } from './handlers/users.js';
import {
  handleGetWorldSummary,
  handleRefreshWorldData,
  handleSearchWorld,
} from './handlers/world.js';
import { toolRegistry } from './registry.js';

/**
 * Routes tool requests to appropriate handlers
 */
export async function routeToolRequest(
  name: string,
  args: Record<string, unknown>,
  foundryClient: FoundryClient,
  diagnosticsClient: DiagnosticsClient,
  diagnosticSystem: DiagnosticSystem,
): Promise<ToolResult> {
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
        `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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

    // Actor mutation tools (#143) — WRITE via the Socket.IO modifyDocument
    // protocol (foundryClient); require FOUNDRY_WRITE_ENABLED=true + a GM user.
    case 'update_actor_attributes':
      if (!('actorId' in args) || typeof args.actorId !== 'string') {
        throw new Error('Missing required parameter: actorId');
      }
      if (!('patch' in args) || typeof args.patch !== 'object' || args.patch === null) {
        throw new Error('Missing required parameter: patch');
      }
      return handleUpdateActorAttribute(
        args as { actorId: string; patch: AttributePatch },
        foundryClient,
      );

    // Item tools
    case 'search_items':
      return handleSearchItems(args, foundryClient);

    // Compendium tools (#144)
    case 'search_compendium':
      if (!('query' in args) || typeof args.query !== 'string') {
        throw new Error('Missing required parameter: query');
      }
      return handleSearchCompendium(
        args as {
          query: string;
          filters?: {
            compendiumId?: string;
            packType?: string;
            itemType?: string;
            spellLevel?: number;
            source?: string;
          };
          limit?: number;
          cursor?: string;
        },
        foundryClient,
      );

    // Item mutation tools (WRITE) — Socket.IO modifyDocument protocol
    // (foundryClient); require FOUNDRY_WRITE_ENABLED=true + a GM user.
    case 'create_actor_item':
      if (!('actorId' in args) || typeof args.actorId !== 'string') {
        throw new Error('Missing required parameter: actorId');
      }
      if (!('source' in args) || typeof args.source !== 'object' || args.source === null) {
        throw new Error('Missing required parameter: source');
      }
      return handleCreateActorItem(
        args as { actorId: string; source: ActorItemCreateSource },
        foundryClient,
      );
    case 'update_actor_item':
      if (!('actorId' in args) || typeof args.actorId !== 'string') {
        throw new Error('Missing required parameter: actorId');
      }
      if (!('itemId' in args) || typeof args.itemId !== 'string') {
        throw new Error('Missing required parameter: itemId');
      }
      if (!('patch' in args) || typeof args.patch !== 'object' || args.patch === null) {
        throw new Error('Missing required parameter: patch');
      }
      return handleUpdateActorItem(
        args as { actorId: string; itemId: string; patch: Record<string, unknown> },
        foundryClient,
      );
    case 'delete_actor_item':
      if (!('actorId' in args) || typeof args.actorId !== 'string') {
        throw new Error('Missing required parameter: actorId');
      }
      if (!('itemId' in args) || typeof args.itemId !== 'string') {
        throw new Error('Missing required parameter: itemId');
      }
      return handleDeleteActorItem(args as { actorId: string; itemId: string }, foundryClient);

    // Scene tools
    case 'get_scene_info':
      return handleGetSceneInfo(args, foundryClient);

    // Combat tools
    case 'get_combat_state':
      return handleGetCombatState(args, foundryClient);

    // Combat mutation tools (FR-018, WRITE — require FOUNDRY_WRITE_ENABLED)
    case 'next_turn':
      return handleNextTurn(args, foundryClient);
    case 'end_combat':
      return handleEndCombat(args, foundryClient);
    case 'set_initiative':
      if (!('combatantId' in args) || typeof args.combatantId !== 'string') {
        throw new Error('Missing required parameter: combatantId');
      }
      if (!('initiative' in args) || typeof args.initiative !== 'number') {
        throw new Error('Missing required parameter: initiative');
      }
      return handleSetInitiative(
        args as { combatantId: string; initiative: number; combatId?: string },
        foundryClient,
      );

    // Token mutation tools (FR-019, WRITE — require FOUNDRY_WRITE_ENABLED)
    case 'move_token':
      if (!('tokenId' in args) || typeof args.tokenId !== 'string') {
        throw new Error('Missing required parameter: tokenId');
      }
      if (!('x' in args) || typeof args.x !== 'number') {
        throw new Error('Missing required parameter: x');
      }
      if (!('y' in args) || typeof args.y !== 'number') {
        throw new Error('Missing required parameter: y');
      }
      return handleMoveToken(
        args as { tokenId: string; x: number; y: number; sceneId?: string },
        foundryClient,
      );
    case 'apply_status_effect':
      if (!('tokenId' in args) || typeof args.tokenId !== 'string') {
        throw new Error('Missing required parameter: tokenId');
      }
      if (!('statusId' in args) || typeof args.statusId !== 'string') {
        throw new Error('Missing required parameter: statusId');
      }
      return handleApplyStatusEffect(
        args as { tokenId: string; statusId: string; active?: boolean; sceneId?: string },
        foundryClient,
      );

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
      return handleGenerateNPC(
        args as { level?: number; race?: string; class?: string },
        foundryClient,
      );
    case 'generate_loot':
      return handleGenerateLoot(
        args as { challengeRating?: number; treasureType?: string },
        foundryClient,
      );
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
      return handleSearchLogs(
        args as { query: string; level?: string; limit?: number },
        diagnosticsClient,
      );
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
  diagnosticsClient: DiagnosticsClient,
) {
  logger.debug(`Routing resource request: ${uri}`);
  return handleReadResource(uri, foundryClient, diagnosticsClient);
}
