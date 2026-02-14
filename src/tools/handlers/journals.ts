/**
 * Journal entry tool handlers
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { FoundryClient } from '../../foundry/client.js';
import { logger } from '../../utils/logger.js';

export async function handleSearchJournals(
  args: { query: string; limit?: number },
  foundryClient: FoundryClient,
) {
  try {
    const results = foundryClient.searchJournals(args.query);
    const limit = args.limit || 10;
    const limited = results.slice(0, limit);

    if (limited.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No journals found matching "${args.query}".`,
          },
        ],
      };
    }

    const formatted = limited.map((j) => {
      const pageCount = j.pages?.length || 0;
      return `- **${j.name}** (${pageCount} page${pageCount !== 1 ? 's' : ''}) — ID: ${j._id}`;
    }).join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `**Journal Search** — "${args.query}" (${results.length} results)\n\n${formatted}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to search journals:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to search journals: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

export async function handleGetJournal(
  args: { journalId: string },
  foundryClient: FoundryClient,
) {
  try {
    const journal = foundryClient.getJournal(args.journalId);

    if (!journal) {
      throw new McpError(ErrorCode.InvalidParams, `Journal not found: ${args.journalId}`);
    }

    const pages = journal.pages?.map((p) => {
      const content = p.text?.content?.replace(/<[^>]+>/g, '').trim().slice(0, 500) || '';
      return `### ${p.name}\n${content}${content.length >= 500 ? '...' : ''}`;
    }).join('\n\n') || 'No pages.';

    return {
      content: [
        {
          type: 'text',
          text: `**Journal: ${journal.name}**\nID: ${journal._id}\n\n${pages}`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof McpError) {throw error;}
    logger.error('Failed to get journal:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to get journal: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
