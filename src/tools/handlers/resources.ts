/**
 * Resource access handlers
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { FoundryClient } from '../../foundry/client.js';
import { DiagnosticsClient } from '../../diagnostics/client.js';
import { logger } from '../../utils/logger.js';

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

      case 'foundry://journals':
        return await getJournalsResource(foundryClient);

      case 'foundry://users':
        return await getUsersResource(foundryClient);

      case 'foundry://combat':
        return await getCombatResource(foundryClient);

      case 'foundry://system/diagnostics':
        return await getSystemDiagnosticsResource(diagnosticsClient);

      default:
        throw new McpError(ErrorCode.InvalidParams, `Unknown resource URI: ${uri}`);
    }
  } catch (error) {
    if (error instanceof McpError) {throw error;}
    logger.error('Failed to read resource:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to read resource: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

async function getActorsResource(foundryClient: FoundryClient) {
  const result = await foundryClient.searchActors({ limit: 100 });
  return {
    contents: [{
      uri: 'foundry://actors',
      mimeType: 'application/json',
      text: JSON.stringify({ actors: result.actors, total: result.total, lastUpdated: new Date().toISOString() }, null, 2),
    }],
  };
}

async function getItemsResource(foundryClient: FoundryClient) {
  const result = await foundryClient.searchItems({ limit: 100 });
  return {
    contents: [{
      uri: 'foundry://items',
      mimeType: 'application/json',
      text: JSON.stringify({ items: result.items, total: result.total, lastUpdated: new Date().toISOString() }, null, 2),
    }],
  };
}

async function getScenesResource(foundryClient: FoundryClient) {
  const scenes = foundryClient.getScenes();
  return {
    contents: [{
      uri: 'foundry://scenes',
      mimeType: 'application/json',
      text: JSON.stringify({ scenes: scenes.map((s) => ({ _id: s._id, name: s.name, active: s.active })), total: scenes.length, lastUpdated: new Date().toISOString() }, null, 2),
    }],
  };
}

async function getCurrentSceneResource(foundryClient: FoundryClient) {
  try {
    const scene = await foundryClient.getCurrentScene();
    return {
      contents: [{
        uri: 'foundry://scenes/current',
        mimeType: 'application/json',
        text: JSON.stringify({ currentScene: scene, lastUpdated: new Date().toISOString() }, null, 2),
      }],
    };
  } catch {
    return {
      contents: [{
        uri: 'foundry://scenes/current',
        mimeType: 'application/json',
        text: JSON.stringify({ currentScene: null, message: 'No active scene', lastUpdated: new Date().toISOString() }, null, 2),
      }],
    };
  }
}

async function getWorldSettingsResource(foundryClient: FoundryClient) {
  const world = await foundryClient.getWorldInfo();
  return {
    contents: [{
      uri: 'foundry://world/settings',
      mimeType: 'application/json',
      text: JSON.stringify({ world, lastUpdated: new Date().toISOString() }, null, 2),
    }],
  };
}

async function getJournalsResource(foundryClient: FoundryClient) {
  const journals = foundryClient.getJournals();
  return {
    contents: [{
      uri: 'foundry://journals',
      mimeType: 'application/json',
      text: JSON.stringify({
        journals: journals.map((j) => ({ _id: j._id, name: j.name, pages: j.pages?.length || 0 })),
        total: journals.length,
        lastUpdated: new Date().toISOString(),
      }, null, 2),
    }],
  };
}

async function getUsersResource(foundryClient: FoundryClient) {
  const { users, activeUsers } = foundryClient.getUsers();
  return {
    contents: [{
      uri: 'foundry://users',
      mimeType: 'application/json',
      text: JSON.stringify({ users, activeUsers, lastUpdated: new Date().toISOString() }, null, 2),
    }],
  };
}

async function getCombatResource(foundryClient: FoundryClient) {
  const combat = foundryClient.getCombatState();
  return {
    contents: [{
      uri: 'foundry://combat',
      mimeType: 'application/json',
      text: JSON.stringify({ combat, lastUpdated: new Date().toISOString() }, null, 2),
    }],
  };
}

async function getSystemDiagnosticsResource(diagnosticsClient: DiagnosticsClient) {
  try {
    const health = await diagnosticsClient.getSystemHealth();
    return {
      contents: [{
        uri: 'foundry://system/diagnostics',
        mimeType: 'application/json',
        text: JSON.stringify({ systemHealth: health, lastUpdated: new Date().toISOString() }, null, 2),
      }],
    };
  } catch {
    return {
      contents: [{
        uri: 'foundry://system/diagnostics',
        mimeType: 'application/json',
        text: JSON.stringify({ message: 'Diagnostics require REST API module', lastUpdated: new Date().toISOString() }, null, 2),
      }],
    };
  }
}
