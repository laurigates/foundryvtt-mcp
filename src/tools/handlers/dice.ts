/**
 * @fileoverview Dice rolling tool handlers
 * 
 * Handles dice rolling operations using FoundryVTT's dice system
 * or fallback mechanisms when the API is unavailable.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { FoundryClient } from '../../foundry/client.js';
import { logger } from '../../utils/logger.js';

/**
 * Handles dice rolling requests
 */
export async function handleRollDice(args: {
  formula: string;
  reason?: string;
}, foundryClient: FoundryClient) {
  const { formula, reason } = args;

  if (!formula || typeof formula !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Formula is required and must be a string');
  }

  try {
    logger.info(`Rolling dice: ${formula}${reason ? ` (${reason})` : ''}`);
    const result = await foundryClient.rollDice(formula, reason);

    return {
      content: [
        {
          type: 'text',
          text: `🎲 **Dice Roll Result**
**Formula:** ${result.formula}
**Total:** ${result.total}
**Breakdown:** ${result.breakdown}
${result.reason ? `**Reason:** ${result.reason}` : ''}
**Timestamp:** ${result.timestamp}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to roll dice:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to roll dice: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}