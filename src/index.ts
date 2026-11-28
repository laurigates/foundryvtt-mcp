#!/usr/bin/env node

/** Local MCP server with isolated Foundry target sessions. */
// ESM must load dotenv before imports that read configuration.
import './load-env.js';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { config } from './config/index.js';
import { FoundrySessionManager } from './sessions/index.js';
import { ToolCatalog } from './tools/catalog.js';
import { logger } from './utils/logger.js';

export class FoundryMCPServer {
  private readonly server: Server;
  private readonly sessions: FoundrySessionManager;
  private readonly catalog: ToolCatalog;
  private connected = false;
  private closing: Promise<void> | undefined;

  constructor() {
    this.server = new Server(
      { name: config.serverName, version: config.serverVersion },
      { capabilities: { resources: { listChanged: true }, tools: { listChanged: true } } },
    );
    this.sessions = new FoundrySessionManager(config.targets, {
      onChange: () => {
        void this.notifyCatalogChange();
      },
    });
    this.catalog = new ToolCatalog(this.sessions);
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.catalog.list(),
    }));
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: this.catalog.listResources(),
    }));
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        return (await this.catalog.call(
          request.params.name,
          request.params.arguments ?? {},
        )) as CallToolResult;
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InvalidParams,
          error instanceof Error ? error.message : 'Tool request failed',
        );
      }
    });
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      try {
        return await this.catalog.readResource(request.params.uri);
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InvalidParams,
          error instanceof Error ? error.message : 'Resource request failed',
        );
      }
    });
    this.server.onclose = () => {
      void this.sessions.close();
    };
  }

  async start(): Promise<void> {
    // Keep discovery and target diagnostics available even when a world is offline.
    await this.server.connect(new StdioServerTransport());
    this.connected = true;
    await this.sessions.start();
    logger.info('FoundryVTT MCP Server started', { targets: this.sessions.list().length });
  }

  async shutdown(): Promise<void> {
    if (!this.closing) {
      this.closing = (async () => {
        this.connected = false;
        await this.sessions.close();
        await this.server.close();
      })();
    }
    return this.closing;
  }

  private async notifyCatalogChange(): Promise<void> {
    if (!this.connected) {
      return;
    }
    try {
      await this.server.sendToolListChanged();
      await this.server.sendResourceListChanged();
    } catch (error) {
      // An initializing/disconnected MCP peer can discover the latest catalog later.
      logger.debug('Catalog notification could not be delivered', error);
    }
  }
}

async function main(): Promise<void> {
  const server = new FoundryMCPServer();
  // stdout belongs exclusively to MCP JSON-RPC.
  process.stderr.write('🎲 FoundryVTT MCP Server starting...\n');
  const stop = async (code: number) => {
    await server.shutdown();
    process.exit(code);
  };
  process.on('SIGINT', () => {
    void stop(0);
  });
  process.on('SIGTERM', () => {
    void stop(0);
  });
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    void stop(1);
  });
  process.on('unhandledRejection', (error) => {
    logger.error('Unhandled rejection', error);
    void stop(1);
  });
  try {
    await server.start();
  } catch (error) {
    logger.error('Failed to start MCP server', error);
    await stop(1);
  }
}

const isMainModule = (() => {
  const argv1 = process.argv[1];
  if (!argv1) {
    return false;
  }
  try {
    return realpathSync(argv1) === fileURLToPath(import.meta.url);
  } catch {
    return import.meta.url === `file://${argv1}`;
  }
})();

if (isMainModule) {
  main().catch((error) => {
    logger.error('Server startup failed', error);
    process.exitCode = 1;
  });
}
