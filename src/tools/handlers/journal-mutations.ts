/**
 * @fileoverview Journal entry mutation tool handlers (create)
 *
 * WRITE operations — require FOUNDRY_WRITE_ENABLED=true and an active Socket.IO
 * connection (mutations use the core `modifyDocument` protocol). `JournalEntry`
 * is a top-level document, so unlike the actor-item mutations there is no
 * parent to scope the write to.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { FoundryClient } from '../../foundry/client.js';
import type { JournalPageCreateSource } from '../../foundry/types.js';
import { withToolError } from './utils.js';

/**
 * Handles creating a journal entry with one or more text pages.
 */
export async function handleCreateJournalEntry(
  args: {
    name: string;
    pages: JournalPageCreateSource[];
    folder?: string;
  },
  foundryClient: FoundryClient,
) {
  const { name, pages, folder } = args;

  if (!name || typeof name !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'name is required and must be a string');
  }
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'pages is required and must contain at least one page',
    );
  }
  for (const page of pages) {
    if (
      !page ||
      typeof page !== 'object' ||
      typeof page.name !== 'string' ||
      typeof page.content !== 'string'
    ) {
      throw new McpError(ErrorCode.InvalidParams, 'each page requires a name and content string');
    }
  }

  return withToolError('create journal entry', async () => {
    const journal = await foundryClient.createJournalEntry(name, pages, folder);

    return {
      content: [
        {
          type: 'text',
          text: `📓 **Journal Entry Created**
**Name:** ${journal.name}
**ID:** ${journal._id}
**Pages:** ${journal.pages?.length ?? pages.length}`,
        },
      ],
    };
  });
}
