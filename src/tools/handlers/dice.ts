/**
 * @fileoverview Dice rolling tool handlers
 * 
 * Handles dice rolling operations using FoundryVTT's dice system
 * or fallback mechanisms when the API is unavailable.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, ToolContext, ToolResult } from '../base.js';
import { FoundryClient } from '../../foundry/client.js';
import { logger } from '../../utils/logger.js';

/**
 * Dice rolling tool implementation
 */
export class RollDiceTool extends BaseTool {
  readonly name = 'roll_dice';
  readonly description = 'Roll dice using standard RPG notation (e.g., 1d20, 3d6+4)';
  readonly inputSchema = {
    type: 'object',
    properties: {
      formula: {
        type: 'string',
        description: 'Dice formula (e.g., "1d20+5", "3d6")',
      },
      reason: {
        type: 'string',
        description: 'Optional reason for the roll',
      },
    },
    required: ['formula'],
  };

  protected async executeValidated(
    args: Record<string, unknown>, 
    context: ToolContext
  ): Promise<ToolResult> {
    const { formula, reason } = args as { formula: string; reason?: string };

    logger.info(`Rolling dice: ${formula}${reason ? ` (${reason})` : ''}`);
    const result = await context.foundryClient.rollDice(formula, reason);

    return this.createTextResponse(`🎲 **Dice Roll Result**
**Formula:** ${result.formula}
**Total:** ${result.total}
**Breakdown:** ${result.breakdown}
${result.reason ? `**Reason:** ${result.reason}` : ''}
**Timestamp:** ${result.timestamp}`);
  }
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use RollDiceTool class instead
 */
export async function handleRollDice(args: {
  formula: string;
  reason?: string;
}, foundryClient: FoundryClient) {
  const tool = new RollDiceTool();
  const context: ToolContext = {
    foundryClient,
    diagnosticsClient: null as any, // Not used in dice rolling
    diagnosticSystem: null as any, // Not used in dice rolling
  };
  return tool.execute(args, context);
}