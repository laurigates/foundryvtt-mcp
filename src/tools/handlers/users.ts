/**
 * User management tool handler
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { FoundryClient } from '../../foundry/client.js';
import { logger } from '../../utils/logger.js';

const ROLE_NAMES: Record<number, string> = {
  0: 'None',
  1: 'Player',
  2: 'Trusted Player',
  3: 'Assistant GM',
  4: 'Game Master',
};

export async function handleGetUsers(_args: Record<string, unknown>, foundryClient: FoundryClient) {
  try {
    const { users, activeUsers } = foundryClient.getUsers();
    const activeSet = new Set(activeUsers);

    const formatted = users
      .map((u) => {
        const online = activeSet.has(u._id) ? 'Online' : 'Offline';
        const role = ROLE_NAMES[u.role] || `Role ${u.role}`;
        return `- **${u.name}** (${role}) — ${online}`;
      })
      .join('\n');

    const onlineCount = users.filter((u) => activeSet.has(u._id)).length;

    return {
      content: [
        {
          type: 'text',
          text: `**Users** (${onlineCount}/${users.length} online)\n\n${formatted}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to get users:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to get users: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
