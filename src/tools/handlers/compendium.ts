/**
 * @fileoverview Compendium search tool handlers
 *
 * Read-only search across FoundryVTT compendium packs by name and metadata.
 * Compendium data is not part of the cached worldData snapshot, so this tool
 * requires the REST API module (FOUNDRY_API_KEY). Without it the search
 * returns gracefully empty and the handler explains why.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { CompendiumSearchParams, FoundryClient } from '../../foundry/client.js';
import { withToolError } from './utils.js';

interface CompendiumFilters {
  compendiumId?: string;
  packType?: string;
  itemType?: string;
  spellLevel?: number;
  source?: string;
}

/**
 * Handles compendium search requests.
 *
 * Searches across all enabled compendiums by default; the `compendiumId`
 * filter scopes the search to a single pack. Returns enough metadata
 * (compendiumId, itemId, type, system.source.rules) to disambiguate
 * near-identical entries across rule revisions.
 */
export async function handleSearchCompendium(
  args: {
    query: string;
    filters?: CompendiumFilters;
    limit?: number;
    cursor?: string;
  },
  foundryClient: FoundryClient,
) {
  const { query, filters, limit = 20, cursor } = args;

  if (!query || typeof query !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'query is required and must be a string');
  }

  return withToolError('search compendium', async () => {
    const params: CompendiumSearchParams = { query, limit };
    if (cursor) {
      params.cursor = cursor;
    }
    if (filters?.compendiumId) {
      params.compendiumId = filters.compendiumId;
    }
    if (filters?.packType) {
      params.packType = filters.packType;
    }
    if (filters?.itemType) {
      params.itemType = filters.itemType;
    }
    if (filters?.spellLevel !== undefined) {
      params.spellLevel = filters.spellLevel;
    }
    if (filters?.source) {
      params.source = filters.source;
    }

    const result = await foundryClient.searchCompendium(params);

    const entryList = result.results
      .map((entry) => {
        const meta: string[] = [`pack: ${entry.compendiumId}`, `id: ${entry.itemId}`];
        if (entry.system?.level !== undefined) {
          meta.push(`level ${entry.system.level}`);
        }
        if (entry.system?.school) {
          meta.push(entry.system.school);
        }
        if (entry.system?.source?.rules) {
          meta.push(`rules: ${entry.system.source.rules}`);
        }
        return `- **${entry.name}** (${entry.type}) — ${meta.join(', ')}`;
      })
      .join('\n');

    const restNote =
      result.restAvailable === false
        ? '\n\n_Note: compendium search requires FOUNDRY_API_KEY (REST API module); returning no results._'
        : '';

    const cursorNote = result.nextCursor
      ? `\n**Next page:** pass cursor \`${result.nextCursor}\` to retrieve more results.`
      : '';

    return {
      content: [
        {
          type: 'text',
          text: `📚 **Compendium Search Results**
**Query:** ${query}
**Pack Filter:** ${filters?.compendiumId || 'All enabled compendiums'}
**Results:** ${result.results.length}/${result.total} total

${entryList || 'No compendium entries found matching the criteria.'}

**Page:** ${result.page} | **Limit:** ${result.limit}${cursorNote}${restNote}`,
        },
      ],
    };
  });
}
