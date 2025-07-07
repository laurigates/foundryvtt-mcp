/**
 * @fileoverview Resource access handlers
 * 
 * Handles read-only access to FoundryVTT resources and data.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { FoundryClient } from '../../foundry/client.js';
import { DiagnosticsClient } from '../../diagnostics/client.js';
import { logger } from '../../utils/logger.js';

/**
 * Handles resource read requests
 */
export async function handleReadResource(uri: string, foundryClient: FoundryClient, diagnosticsClient: DiagnosticsClient) {
  logger.info('Reading resource', { uri });

  try {
    switch (uri) {
      case 'foundry://actors':
        return await getActorsResource(foundryClient);
      
      case 'foundry://items':
        return await getItemsResource(foundryClient);
      
      case 'foundry://scenes':
        return await getScenesResource(foundryClient);
      
      case 'foundry://scenes/current':
        return await getCurrentSceneResource(foundryClient);
      
      case 'foundry://world/settings':
        return await getWorldSettingsResource(foundryClient);
      
      case 'foundry://system/diagnostics':
        return await getSystemDiagnosticsResource(diagnosticsClient);
      
      default:
        throw new McpError(ErrorCode.InvalidParams, `Unknown resource URI: ${uri}`);
    }
  } catch (error) {
    logger.error('Failed to read resource:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to read resource: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

async function getActorsResource(foundryClient: FoundryClient) {
  const actors = await foundryClient.searchActors({ limit: 100 });
  return {
    contents: [
      {
        uri: 'foundry://actors',
        mimeType: 'application/json',
        text: JSON.stringify({
          actors: actors.actors,
          total: actors.total,
          lastUpdated: new Date().toISOString(),
        }, null, 2),
      },
    ],
  };
}

async function getItemsResource(foundryClient: FoundryClient) {
  const items = await foundryClient.searchItems({ limit: 100 });
  return {
    contents: [
      {
        uri: 'foundry://items',
        mimeType: 'application/json',
        text: JSON.stringify({
          items: items.items,
          total: items.total,
          lastUpdated: new Date().toISOString(),
        }, null, 2),
      },
    ],
  };
}

async function getScenesResource(_foundryClient: FoundryClient) {
  // Note: This would require a searchScenes method in FoundryClient
  // For now, return minimal data
  return {
    contents: [
      {
        uri: 'foundry://scenes',
        mimeType: 'application/json',
        text: JSON.stringify({
          scenes: [],
          message: 'Scene listing requires additional API endpoints',
          lastUpdated: new Date().toISOString(),
        }, null, 2),
      },
    ],
  };
}

async function getCurrentSceneResource(foundryClient: FoundryClient) {
  const scene = await foundryClient.getCurrentScene();
  return {
    contents: [
      {
        uri: 'foundry://scenes/current',
        mimeType: 'application/json',
        text: JSON.stringify({
          currentScene: scene,
          lastUpdated: new Date().toISOString(),
        }, null, 2),
      },
    ],
  };
}

async function getWorldSettingsResource(foundryClient: FoundryClient) {
  const world = await foundryClient.getWorldInfo();
  return {
    contents: [
      {
        uri: 'foundry://world/settings',
        mimeType: 'application/json',
        text: JSON.stringify({
          world,
          lastUpdated: new Date().toISOString(),
        }, null, 2),
      },
    ],
  };
}

async function getSystemDiagnosticsResource(diagnosticsClient: DiagnosticsClient) {
  const health = await diagnosticsClient.getSystemHealth();
  return {
    contents: [
      {
        uri: 'foundry://system/diagnostics',
        mimeType: 'application/json',
        text: JSON.stringify({
          systemHealth: health,
          lastUpdated: new Date().toISOString(),
        }, null, 2),
      },
    ],
  };
}