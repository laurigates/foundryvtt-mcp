/**
 * @fileoverview Item management tool handlers
 * 
 * Handles searching for items and retrieving detailed item information.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { FoundryClient } from '../../foundry/client.js';
import { logger } from '../../utils/logger.js';

/**
 * Handles item search requests
 */
export async function handleSearchItems(args: {
  query?: string;
  type?: string;
  rarity?: string;
  limit?: number;
}, foundryClient: FoundryClient) {
  const { query, type, rarity, limit = 10 } = args;

  try {
    logger.info('Searching items', { query, type, rarity, limit });
    const searchParams: { query: string; type?: string; rarity?: string; limit: number } = { 
      query: query || '',
      limit 
    };
    if (type) {
      searchParams.type = type;
    }
    if (rarity) {
      searchParams.rarity = rarity;
    }
    const result = await foundryClient.searchItems(searchParams);

    const itemList = result.items.map(item => {
      const price = item.price ? `${item.price.value} ${item.price.denomination}` : 'Unknown price';
      return `- **${item.name}** (${item.type}) - ${item.rarity || 'Common'} - ${price}`;
    }).join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `⚔️ **Item Search Results**
**Query:** ${query || 'All items'}
**Type Filter:** ${type || 'All types'}
**Rarity Filter:** ${rarity || 'All rarities'}
**Results:** ${result.items.length}/${result.total} total

${itemList || 'No items found matching the criteria.'}

**Page:** ${result.page} | **Limit:** ${result.limit}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to search items:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to search items: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}