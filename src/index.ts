#!/usr/bin/env node

/**
 * FoundryVTT Model Context Protocol Server
 *
 * This server provides integration between FoundryVTT and AI models through the Model Context Protocol (MCP).
 * It enables AI assistants to interact with FoundryVTT instances for RPG campaign management,
 * character handling, and game automation.
 *
 * @fileoverview Main entry point for the FoundryVTT MCP Server
 * @version 0.1.0
 * @author FoundryVTT MCP Team
 * @see {@link https://github.com/anthropics/mcp} Model Context Protocol
 * @see {@link https://foundryvtt.com/} FoundryVTT Virtual Tabletop
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { FoundryClient } from './foundry/client.js';
import { DiagnosticsClient } from './diagnostics/client.js';
import { DiagnosticSystem } from './utils/diagnostics.js';
import { logger } from './utils/logger.js';
import { config } from './config/index.js';
import { getAllTools, getAllResources, routeToolRequest, routeResourceRequest } from './tools/index.js';

// Load environment variables
dotenv.config();

/**
 * Main FoundryVTT MCP Server class that handles all communication
 * between AI models and FoundryVTT instances.
 */
class FoundryMCPServer {
  private server: Server;
  private foundryClient: FoundryClient;
  private diagnosticsClient: DiagnosticsClient;
  private diagnosticSystem: DiagnosticSystem;

  /**
   * Creates a new FoundryMCPServer instance.
   * Initializes the MCP server, FoundryVTT client, and sets up all handlers.
   */
  constructor() {
    this.server = new Server(
      {
        name: config.serverName,
        version: config.serverVersion,
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // Initialize FoundryVTT client with configuration
    this.foundryClient = new FoundryClient({
      baseUrl: config.foundry.url,
      apiKey: config.foundry.apiKey || '',
      username: config.foundry.username || '',
      password: config.foundry.password || '',
      socketPath: config.foundry.socketPath,
      timeout: config.foundry.timeout,
      retryAttempts: config.foundry.retryAttempts,
      retryDelay: config.foundry.retryDelay,
    });

    // Initialize DiagnosticsClient
    this.diagnosticsClient = new DiagnosticsClient(this.foundryClient);

    // Initialize DiagnosticSystem
    this.diagnosticSystem = new DiagnosticSystem(this.foundryClient);

    this.setupHandlers();
  }

  /**
   * Sets up all MCP request handlers for tools, resources, and functionality.
   * @private
   */
  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.info('Listing available tools');
      return {
        tools: getAllTools(),
      };
    });

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      logger.info('Listing available resources');
      return {
        resources: getAllResources(),
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      logger.info('Executing tool', { name, args });

      try {
        return await routeToolRequest(
          name,
          args || {},
          this.foundryClient,
          this.diagnosticsClient,
          this.diagnosticSystem
        );
      } catch (error) {
        logger.error('Tool execution failed:', error);
        
        if (error instanceof McpError) {
          throw error;
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });

    // Handle resource reads
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      logger.info('Reading resource', { uri });

      try {
        return await routeResourceRequest(uri, this.foundryClient, this.diagnosticsClient);
      } catch (error) {
        logger.error('Resource read failed:', error);
        
        if (error instanceof McpError) {
          throw error;
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          `Resource read failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  /**
   * Connects to FoundryVTT and starts the MCP server.
   * @returns Promise that resolves when the server is running
   */
  async start(): Promise<void> {
    try {
      // Connect to FoundryVTT
      await this.foundryClient.connect();
      logger.info('Connected to FoundryVTT successfully');

      // Start the MCP server
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info('FoundryVTT MCP Server started successfully');
    } catch (error) {
      logger.error('Failed to start server:', error);
      throw error;
    }
  }

  /**
   * Gracefully shuts down the server and connections.
   * @returns Promise that resolves when shutdown is complete
   */
  async shutdown(): Promise<void> {
    try {
      await this.foundryClient.disconnect();
      logger.info('FoundryVTT MCP Server shutdown completed');
    } catch (error) {
      logger.error('Error during shutdown:', error);
    }
  }
}

/**
 * Main entry point - creates and starts the server
 */
async function main(): Promise<void> {
  const server = new FoundryMCPServer();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await server.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await server.shutdown();
    process.exit(0);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', { promise, reason });
    process.exit(1);
  });

  try {
    await server.start();
  } catch (error) {
    logger.error('Failed to start FoundryVTT MCP Server:', error);
    process.exit(1);
  }
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error('Server startup failed:', error);
    process.exit(1);
  });
}