/**
 * Journal entry tool handlers
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { FoundryClient } from '../../foundry/client.js';
import { withToolError } from './utils.js';

export async function handleSearchJournals(
  args: { query: string; limit?: number },
  foundryClient: FoundryClient,
) {
  return withToolError('search journals', async () => {
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

    const formatted = limited
      .map((j) => {
        const pageCount = j.pages?.length || 0;
        return `- **${j.name}** (${pageCount} page${pageCount !== 1 ? 's' : ''}) — ID: ${j._id}`;
      })
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `**Journal Search** — "${args.query}" (${results.length} results)\n\n${formatted}`,
        },
      ],
    };
  });
}

export async function handleGetJournal(args: { journalId: string }, foundryClient: FoundryClient) {
  return withToolError('get journal', async () => {
    const journal = foundryClient.getJournal(args.journalId);

    if (!journal) {
      throw new McpError(ErrorCode.InvalidParams, `Journal not found: ${args.journalId}`);
    }

    const pages =
      journal.pages
        ?.map((p) => {
          const content =
            p.text?.content
              ?.replace(/<[^>]+>/g, '')
              .trim()
              .slice(0, 500) || '';
          return `### ${p.name}\n${content}${content.length >= 500 ? '...' : ''}`;
        })
        .join('\n\n') || 'No pages.';

    return {
      content: [
        {
          type: 'text',
          text: `**Journal: ${journal.name}**\nID: ${journal._id}\n\n${pages}`,
        },
      ],
    };
  });
}
