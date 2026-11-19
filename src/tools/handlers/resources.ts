/**
 * Resource access handlers
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { DiagnosticsClient } from '../../diagnostics/client.js';
import type { FoundryCore } from '../../providers/types.js';
import { logger } from '../../utils/logger.js';
import { getTurnOrder } from './combat-order.js';
import { withToolError } from './utils.js';

export async function handleReadResource(
  uri: string,
  provider: FoundryCore,
  diagnosticsClient: DiagnosticsClient,
) {
  return withToolError('read resource', async () => {
    switch (uri) {
      case 'foundry://actors':
        return await getActorsResource(provider);

      case 'foundry://items':
        return await getItemsResource(provider);

      case 'foundry://scenes':
        return await getScenesResource(provider);

      case 'foundry://scenes/current':
        return await getCurrentSceneResource(provider);

      case 'foundry://world/settings':
        return await getWorldSettingsResource(provider);

      case 'foundry://journals':
        return await getJournalsResource(provider);

      case 'foundry://users':
        return await getUsersResource(provider);

      case 'foundry://combat':
        return await getCombatResource(provider);

      case 'foundry://system/diagnostics':
        return await getSystemDiagnosticsResource(diagnosticsClient);

      default:
        throw new McpError(ErrorCode.InvalidParams, `Unknown resource URI: ${uri}`);
    }
  });
}

async function getActorsResource(provider: FoundryCore) {
  const result = await provider.searchActors({ limit: 100 });
  return {
    contents: [
      {
        uri: 'foundry://actors',
        mimeType: 'application/json',
        text: JSON.stringify(
          { actors: result.actors, total: result.total, lastUpdated: new Date().toISOString() },
          null,
          2,
        ),
      },
    ],
  };
}

async function getItemsResource(provider: FoundryCore) {
  const result = await provider.searchItems({ limit: 100 });
  return {
    contents: [
      {
        uri: 'foundry://items',
        mimeType: 'application/json',
        text: JSON.stringify(
          { items: result.items, total: result.total, lastUpdated: new Date().toISOString() },
          null,
          2,
        ),
      },
    ],
  };
}

async function getScenesResource(provider: FoundryCore) {
  const scenes = provider.getScenes();
  return {
    contents: [
      {
        uri: 'foundry://scenes',
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            scenes: scenes.map((s) => ({ _id: s._id, name: s.name, active: s.active })),
            total: scenes.length,
            lastUpdated: new Date().toISOString(),
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function getCurrentSceneResource(provider: FoundryCore) {
  try {
    const scene = await provider.getCurrentScene();
    return {
      contents: [
        {
          uri: 'foundry://scenes/current',
          mimeType: 'application/json',
          text: JSON.stringify(
            { currentScene: scene, lastUpdated: new Date().toISOString() },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.debug('getCurrentSceneResource: no active scene', { error });
    return {
      contents: [
        {
          uri: 'foundry://scenes/current',
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              currentScene: null,
              message: 'No active scene',
              lastUpdated: new Date().toISOString(),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}

async function getWorldSettingsResource(provider: FoundryCore) {
  const world = await provider.getWorldInfo();
  return {
    contents: [
      {
        uri: 'foundry://world/settings',
        mimeType: 'application/json',
        text: JSON.stringify({ world, lastUpdated: new Date().toISOString() }, null, 2),
      },
    ],
  };
}

async function getJournalsResource(provider: FoundryCore) {
  const journals = provider.getJournals();
  return {
    contents: [
      {
        uri: 'foundry://journals',
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            journals: journals.map((j) => ({
              _id: j._id,
              name: j.name,
              pages: j.pages?.length || 0,
            })),
            total: journals.length,
            lastUpdated: new Date().toISOString(),
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function getUsersResource(provider: FoundryCore) {
  const { users, activeUsers } = provider.getUsers();
  return {
    contents: [
      {
        uri: 'foundry://users',
        mimeType: 'application/json',
        text: JSON.stringify(
          { users, activeUsers, lastUpdated: new Date().toISOString() },
          null,
          2,
        ),
      },
    ],
  };
}

/**
 * Serves the active combat encounter (#214 follow-up).
 *
 * `Combat#turn` indexes the **initiative-sorted** turn order, and this resource
 * is the id-bearing companion to `get_combat_state`, whose ordinals are printed
 * in that same order. Emitting the raw cached `combatants` array — which is in
 * creation order — next to that `turn` makes both `combat.combatants[turn]` and
 * "the Nth combatant I just read" resolve to the wrong document, so the emitted
 * `combatants` are re-ordered here through the shared `getTurnOrder()` helper.
 *
 * `getTurnOrder()` sorts a copy: the cached array is a live reference into
 * worldData and must not be reordered as a side effect of a read.
 */
async function getCombatResource(provider: FoundryCore) {
  const cached = provider.getCombatState();
  const combat = cached ? { ...cached, combatants: getTurnOrder(cached) } : cached;
  return {
    contents: [
      {
        uri: 'foundry://combat',
        mimeType: 'application/json',
        text: JSON.stringify({ combat, lastUpdated: new Date().toISOString() }, null, 2),
      },
    ],
  };
}

async function getSystemDiagnosticsResource(diagnosticsClient: DiagnosticsClient) {
  try {
    const health = await diagnosticsClient.getSystemHealth();
    return {
      contents: [
        {
          uri: 'foundry://system/diagnostics',
          mimeType: 'application/json',
          text: JSON.stringify(
            { systemHealth: health, lastUpdated: new Date().toISOString() },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.debug('getSystemDiagnosticsResource: diagnostics unavailable', { error });
    return {
      contents: [
        {
          uri: 'foundry://system/diagnostics',
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              message: 'Diagnostics require REST API module',
              lastUpdated: new Date().toISOString(),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
