/**
 * Shared utilities for tool handlers
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../utils/logger.js';

/**
 * Wraps an async handler function with standard error logging and McpError conversion.
 *
 * @param toolName - Label used in error log messages (e.g. 'search actors')
 * @param fn - Async function containing the handler logic
 */
export async function withToolError<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    logger.error(`Failed to ${toolName}:`, error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to ${toolName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
