/**
 * @fileoverview New tool routing implementation using registry pattern
 *
 * This module provides a cleaner routing system that uses the tool registry
 * and eliminates the need for manual switch statements and validation.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { DiagnosticsClient } from '../diagnostics/client.js';
import type { FoundryClient } from '../foundry/client.js';
import type { DiagnosticSystem } from '../utils/diagnostics.js';
import { logger } from '../utils/logger.js';
import type { ToolContext } from './base.js';
// Import legacy handlers for tools not yet converted
import { handleGetActorDetails, handleSearchActors } from './handlers/actors.js';
import {
  handleDiagnoseErrors,
  handleGetHealthStatus,
  handleGetRecentLogs,
  handleGetSystemHealth,
  handleSearchLogs,
} from './handlers/diagnostics.js';
import { handleGenerateLoot, handleGenerateNPC, handleLookupRule } from './handlers/generation.js';
import { handleSearchItems } from './handlers/items.js';
import { handleReadResource } from './handlers/resources.js';
import { handleGetSceneInfo } from './handlers/scenes.js';
import { toolRegistry } from './registry.js';

/**
 * Routes tool requests using the new registry system
 */
export async function routeToolRequest(
  name: string,
  args: Record<string, unknown>,
  foundryClient: FoundryClient,
  diagnosticsClient: DiagnosticsClient,
  diagnosticSystem: DiagnosticSystem,
) {
  logger.debug(`Routing tool request: ${name}`, { args });

  const context: ToolContext = {
    foundryClient,
    diagnosticsClient,
    diagnosticSystem,
  };

  // Try to execute using the new registry system
  if (toolRegistry.has(name)) {
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

  // Fallback to legacy handlers for tools not yet converted
  return await routeLegacyTool(name, args, foundryClient, diagnosticsClient, diagnosticSystem);
}

/**
 * Legacy routing for tools not yet converted to the new system
 * @deprecated This will be removed once all tools are converted
 */
async function routeLegacyTool(
  name: string,
  args: Record<string, unknown>,
  foundryClient: FoundryClient,
  diagnosticsClient: DiagnosticsClient,
  diagnosticSystem: DiagnosticSystem,
) {
  switch (name) {
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

    // Diagnostics tools
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
