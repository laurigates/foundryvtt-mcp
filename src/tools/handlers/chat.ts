/**
 * Chat message tool handler
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { FoundryClient } from '../../foundry/client.js';
import { logger } from '../../utils/logger.js';

export async function handleGetChatMessages(
  args: { limit?: number },
  foundryClient: FoundryClient,
) {
  try {
    const limit = args.limit || 20;
    const messages = foundryClient.getChatMessages(limit);

    if (messages.length === 0) {
      return {
        content: [{ type: 'text', text: 'No chat messages found.' }],
      };
    }

    // Resolve user names from worldData
    const { users } = foundryClient.getUsers();
    const userMap = new Map(users.map((u) => [u._id, u.name]));

    const formatted = messages
      .map((m) => {
        const speaker = m.speaker?.alias || userMap.get(m.user) || 'Unknown';
        const time = new Date(m.timestamp).toLocaleTimeString();
        const content = m.content
          .replace(/<[^>]+>/g, '')
          .trim()
          .slice(0, 200);
        return `[${time}] **${speaker}**: ${content}`;
      })
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `**Recent Chat Messages** (${messages.length})\n\n${formatted}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to get chat messages:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to get chat messages: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
