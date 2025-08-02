/**
 * @fileoverview Base tool interface and implementation
 * 
 * This module provides the foundation for the tool system with automatic
 * schema validation and consistent interface design.
 */

import Ajv from 'ajv';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { FoundryClient } from '../foundry/client.js';
import { DiagnosticsClient } from '../diagnostics/client.js';
import { DiagnosticSystem } from '../utils/diagnostics.js';
import { logger } from '../utils/logger.js';

/**
 * Tool execution context containing all necessary dependencies
 */
export interface ToolContext {
  foundryClient: FoundryClient;
  diagnosticsClient: DiagnosticsClient;
  diagnosticSystem: DiagnosticSystem;
}

/**
 * Tool execution result with MCP-compatible format
 * This matches the return type of existing handlers
 */
export type ToolResult = any;

/**
 * Base interface for all tools
 */
export interface Tool {
  /** Tool name (must match schema name) */
  readonly name: string;
  
  /** Tool description */
  readonly description: string;
  
  /** JSON Schema for input validation */
  readonly inputSchema: object;
  
  /**
   * Execute the tool with validated arguments
   * @param args - Validated input arguments
   * @param context - Tool execution context
   * @returns Tool execution result
   */
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

/**
 * Base tool class with automatic validation
 */
export abstract class BaseTool implements Tool {
  private static readonly ajv = new Ajv({ 
    allErrors: true, 
    verbose: true,
    strict: false // Allow additional properties for flexibility
  });

  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly inputSchema: object;

  /**
   * Execute the tool with automatic validation
   */
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    logger.debug(`Executing tool: ${this.name}`, { args });

    // Validate input arguments against schema
    this.validateArgs(args);

    try {
      return await this.executeValidated(args, context);
    } catch (error) {
      logger.error(`Tool execution failed: ${this.name}`, error);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Execute the tool with validated arguments (must be implemented by subclasses)
   */
  protected abstract executeValidated(
    args: Record<string, unknown>, 
    context: ToolContext
  ): Promise<ToolResult>;

  /**
   * Validate arguments against the tool's schema
   */
  private validateArgs(args: Record<string, unknown>): void {
    const validate = BaseTool.ajv.compile(this.inputSchema);
    const valid = validate(args);

    if (!valid) {
      const errors = validate.errors?.map(err => {
        const instancePath = err.instancePath || 'root';
        return `${instancePath}: ${err.message}`;
      }).join(', ') || 'Unknown validation error';

      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters for tool '${this.name}': ${errors}`
      );
    }
  }

  /**
   * Helper method to create a text response
   */
  protected createTextResponse(text: string): ToolResult {
    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  }

  /**
   * Helper method to create an error response
   */
  protected createErrorResponse(error: Error): ToolResult {
    return this.createTextResponse(`❌ **Error**: ${error.message}`);
  }
}