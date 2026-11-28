/**
 * Journal entry tool handlers
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { stripMarkup } from '../../foundry/world-search.js';
import type { FoundryCore } from '../../providers/types.js';
import { withToolError } from './utils.js';

export async function handleSearchJournals(
  args: { query: string; limit?: number },
  provider: FoundryCore,
) {
  return withToolError('search journals', async () => {
    const results = provider.searchJournals(args.query);
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

export async function handleGetJournal(args: { journalId: string }, provider: FoundryCore) {
  return withToolError('get journal', async () => {
    const journal = provider.getJournal(args.journalId);

    if (!journal) {
      throw new McpError(ErrorCode.InvalidParams, `Journal not found: ${args.journalId}`);
    }

    const pages =
      journal.pages
        ?.map((p) => {
          const content =
            stripMarkup(p.text?.content ?? '')
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
