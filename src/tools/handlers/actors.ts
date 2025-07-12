/**
 * @fileoverview Actor management tool handlers
 * 
 * Handles searching for actors and retrieving detailed actor information.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { FoundryClient } from '../../foundry/client.js';
import { logger } from '../../utils/logger.js';

/**
 * Handles actor search requests
 */
export async function handleSearchActors(args: {
  query?: string;
  type?: string;
  limit?: number;
}, foundryClient: FoundryClient) {
  const { query, type, limit = 10 } = args;

  try {
    logger.info('Searching actors', { query, type, limit });
    const searchParams: { query: string; type?: string; limit: number } = { 
      query: query || '',
      limit 
    };
    if (type) {
      searchParams.type = type;
    }
    const result = await foundryClient.searchActors(searchParams);

    const actorList = result.actors.map(actor => 
      `- **${actor.name}** (${actor.type}) - Level ${actor.level || 'Unknown'} - HP: ${actor.hp?.value || 'Unknown'}/${actor.hp?.max || 'Unknown'}`
    ).join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `🎭 **Actor Search Results**
**Query:** ${query || 'All actors'}
**Type Filter:** ${type || 'All types'}
**Results:** ${result.actors.length}/${result.total} total

${actorList || 'No actors found matching the criteria.'}

**Page:** ${result.page} | **Limit:** ${result.limit}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to search actors:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to search actors: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Handles detailed actor information requests
 */
export async function handleGetActorDetails(args: {
  actorId: string;
}, foundryClient: FoundryClient) {
  const { actorId } = args;

  if (!actorId || typeof actorId !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Actor ID is required and must be a string');
  }

  try {
    logger.info('Getting actor details', { actorId });
    const actor = await foundryClient.getActor(actorId);

    const abilities = actor.abilities ? Object.entries(actor.abilities)
      .map(([key, ability]: [string, { value: number; mod: number }]) => `**${key.toUpperCase()}:** ${ability.value} (${ability.mod >= 0 ? '+' : ''}${ability.mod})`)
      .join('\n') : 'No ability scores available';

    return {
      content: [
        {
          type: 'text',
          text: `🎭 **Actor Details: ${actor.name}**
**Type:** ${actor.type}
**Level:** ${actor.level || 'Unknown'}
**Hit Points:** ${actor.hp?.value || 'Unknown'}/${actor.hp?.max || 'Unknown'}
**Armor Class:** ${actor.ac?.value || 'Unknown'}

**Ability Scores:**
${abilities}

**Description:** ${(actor as { description?: string }).description || 'No description available.'}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to get actor details:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to get actor details: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}