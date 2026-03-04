/**
 * @fileoverview Scene management tool handlers
 *
 * Handles scene information retrieval and management.
 */

import type { FoundryClient } from '../../foundry/client.js';
import { withToolError } from './utils.js';

/**
 * Handles scene information requests
 */
export async function handleGetSceneInfo(
  args: {
    sceneId?: string;
  },
  foundryClient: FoundryClient,
) {
  const { sceneId } = args;

  return withToolError('get scene info', async () => {
    const scene = await foundryClient.getCurrentScene(sceneId);

    return {
      content: [
        {
          type: 'text',
          text: `🗺️ **Scene Information**
**Name:** ${scene.name}
**ID:** ${scene._id}
**Active:** ${scene.active ? 'Yes' : 'No'}
**Navigation:** ${scene.navigation ? 'Enabled' : 'Disabled'}
**Dimensions:** ${scene.width} x ${scene.height} pixels
**Padding:** ${scene.padding * 100}%
**Global Light:** ${scene.globalLight ? 'Enabled' : 'Disabled'}
**Darkness Level:** ${scene.darkness * 100}%

**Description:** ${scene.description || 'No description available.'}`,
        },
      ],
    };
  });
}
