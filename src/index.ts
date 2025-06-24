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
        tools: [
          {
            name: 'roll_dice',
            description: 'Roll dice using standard RPG notation (e.g., 1d20, 3d6+4)',
            inputSchema: {
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
            },
          },
          {
            name: 'search_actors',
            description: 'Search for actors (characters, NPCs) in FoundryVTT',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query for actor names',
                },
                type: {
                  type: 'string',
                  description: 'Actor type filter (character, npc, etc.)',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return',
                  default: 10,
                },
              },
            },
          },
          {
            name: 'get_actor_details',
            description: 'Get detailed information about a specific actor',
            inputSchema: {
              type: 'object',
              properties: {
                actorId: {
                  type: 'string',
                  description: 'The ID of the actor to retrieve',
                },
              },
              required: ['actorId'],
            },
          },
          {
            name: 'search_items',
            description: 'Search for items in FoundryVTT',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query for item names',
                },
                type: {
                  type: 'string',
                  description: 'Item type filter (weapon, armor, consumable, etc.)',
                },
                rarity: {
                  type: 'string',
                  description: 'Item rarity filter (common, uncommon, rare, etc.)',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return',
                  default: 10,
                },
              },
            },
          },
          {
            name: 'get_scene_info',
            description: 'Get information about the current or specified scene',
            inputSchema: {
              type: 'object',
              properties: {
                sceneId: {
                  type: 'string',
                  description: 'Optional scene ID. If not provided, returns current scene',
                },
              },
            },
          },
          {
            name: 'generate_npc',
            description: 'Generate a random NPC with personality, appearance, and stats',
            inputSchema: {
              type: 'object',
              properties: {
                race: {
                  type: 'string',
                  description: 'NPC race (optional, will be random if not specified)',
                },
                level: {
                  type: 'number',
                  description: 'NPC level (optional, will be random if not specified)',
                },
                role: {
                  type: 'string',
                  description: 'NPC role (merchant, guard, noble, etc.)',
                },
                alignment: {
                  type: 'string',
                  description: 'NPC alignment (optional)',
                },
              },
            },
          },
          {
            name: 'generate_loot',
            description: 'Generate random treasure and loot based on challenge rating',
            inputSchema: {
              type: 'object',
              properties: {
                challengeRating: {
                  type: 'number',
                  description: 'Challenge rating to base loot generation on',
                },
                treasureType: {
                  type: 'string',
                  description: 'Type of treasure (individual, hoard, art, gems)',
                  default: 'individual',
                },
                includeCoins: {
                  type: 'boolean',
                  description: 'Whether to include coin rewards',
                  default: true,
                },
              },
              required: ['challengeRating'],
            },
          },
          {
            name: 'lookup_rule',
            description: 'Look up game rules and mechanics',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Rule or mechanic to look up',
                },
                category: {
                  type: 'string',
                  description: 'Optional category (combat, spells, conditions, etc.)',
                },
                system: {
                  type: 'string',
                  description: 'Game system (defaults to D&D 5e)',
                  default: 'dnd5e',
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'get_recent_logs',
            description: 'Get recent FoundryVTT server logs for debugging and monitoring',
            inputSchema: {
              type: 'object',
              properties: {
                lines: {
                  type: 'number',
                  description: 'Number of log lines to retrieve',
                  default: 50,
                },
                level: {
                  type: 'string',
                  enum: ['log', 'warn', 'error', 'info', 'notification'],
                  description: 'Filter by log level',
                },
                since: {
                  type: 'string',
                  description: 'ISO timestamp to filter logs since',
                },
                source: {
                  type: 'string',
                  enum: ['foundry', 'module', 'system', 'api', 'unknown'],
                  description: 'Filter by log source',
                },
                includeStack: {
                  type: 'boolean',
                  description: 'Include stack traces in error logs',
                  default: false,
                },
              },
            },
          },
          {
            name: 'search_logs',
            description: 'Search FoundryVTT logs for specific patterns or errors',
            inputSchema: {
              type: 'object',
              properties: {
                pattern: {
                  type: 'string',
                  description: 'Regular expression pattern to search for',
                },
                timeframe: {
                  type: 'string',
                  description: 'Time window in seconds (e.g., "3600" for last hour)',
                },
                level: {
                  type: 'string',
                  enum: ['log', 'warn', 'error', 'info', 'notification'],
                  description: 'Filter by log level',
                },
                caseSensitive: {
                  type: 'boolean',
                  description: 'Case-sensitive search',
                  default: false,
                },
              },
              required: ['pattern'],
            },
          },
          {
            name: 'get_system_health',
            description: 'Get FoundryVTT server health and performance metrics',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'diagnose_errors',
            description: 'Analyze recent errors and provide diagnostic suggestions',
            inputSchema: {
              type: 'object',
              properties: {
                timeframe: {
                  type: 'number',
                  description: 'Time window in seconds to analyze',
                  default: 3600,
                },
              },
            },
          },
          {
            name: 'get_health_status',
            description: 'Get comprehensive health check and system status',
            inputSchema: {
              type: 'object',
              properties: {
                detailed: {
                  type: 'boolean',
                  description: 'Include detailed diagnostic information',
                  default: true,
                },
              },
            },
          },
        ],
      };
    });

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      logger.info('Listing available resources');
      return {
        resources: [
          {
            uri: 'foundry://world/actors',
            name: 'All Actors',
            description: 'Complete list of all actors in the current world',
            mimeType: 'application/json',
          },
          {
            uri: 'foundry://world/items',
            name: 'All Items',
            description: 'Complete list of all items in the current world',
            mimeType: 'application/json',
          },
          {
            uri: 'foundry://world/scenes',
            name: 'All Scenes',
            description: 'Complete list of all scenes in the current world',
            mimeType: 'application/json',
          },
          {
            uri: 'foundry://scene/current',
            name: 'Current Scene',
            description: 'Information about the currently active scene',
            mimeType: 'application/json',
          },
          {
            uri: 'foundry://settings/game',
            name: 'Game Settings',
            description: 'Current game and system settings',
            mimeType: 'application/json',
          },
          {
            uri: 'foundry://compendium/spells',
            name: 'Spell Compendium',
            description: 'Reference spells and magic',
            mimeType: 'application/json',
          },
          {
            uri: 'foundry://compendium/monsters',
            name: 'Monster Compendium',
            description: 'Reference monsters and creatures',
            mimeType: 'application/json',
          },
          {
            uri: 'foundry://compendium/items',
            name: 'Item Compendium',
            description: 'Reference equipment and items',
            mimeType: 'application/json',
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      logger.info(`Calling tool: ${name}`, { args });

      try {
        switch (name) {
          case 'roll_dice':
            return await this.handleRollDice(args);
          case 'search_actors':
            return await this.handleSearchActors(args);
          case 'get_actor_details':
            return await this.handleGetActorDetails(args);
          case 'search_items':
            return await this.handleSearchItems(args);
          case 'get_scene_info':
            return await this.handleGetSceneInfo(args);
          case 'generate_npc':
            return await this.handleGenerateNPC(args);
          case 'generate_loot':
            return await this.handleGenerateLoot(args);
          case 'lookup_rule':
            return await this.handleLookupRule(args);
          case 'get_recent_logs':
            return await this.handleGetRecentLogs(args);
          case 'search_logs':
            return await this.handleSearchLogs(args);
          case 'get_system_health':
            return await this.handleGetSystemHealth(args);
          case 'diagnose_errors':
            return await this.handleDiagnoseErrors(args);
          case 'get_health_status':
            return await this.handleGetHealthStatus(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        logger.error(`Error executing tool ${name}:`, error);

        if (error instanceof McpError) {
          throw error;
        }

        throw new McpError(
          ErrorCode.InternalError,
          `Failed to execute tool: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });

    // Handle resource reads
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      logger.info(`Reading resource: ${uri}`);

      try {
        if (uri.startsWith('foundry://actors/')) {
          const actorId = uri.replace('foundry://actors/', '');
          return await this.readActorResource(actorId);
        }

        if (uri.startsWith('foundry://scenes/')) {
          const sceneId = uri.replace('foundry://scenes/', '');
          return await this.readSceneResource(sceneId);
        }

        // Handle general world resources
        switch (uri) {
          case 'foundry://world/actors':
            return await this.readAllActorsResource();
          case 'foundry://world/items':
            return await this.readAllItemsResource();
          case 'foundry://world/scenes':
            return await this.readAllScenesResource();
          case 'foundry://scene/current':
            return await this.readCurrentSceneResource();
          case 'foundry://settings/game':
            return await this.readGameSettingsResource();
          case 'foundry://compendium/spells':
          case 'foundry://compendium/monsters':
          case 'foundry://compendium/items':
            const compendiumType = uri.split('/').pop();
            return await this.readCompendiumResource(compendiumType || '');
          default:
            throw new McpError(
              ErrorCode.InvalidRequest,
              `Unknown resource URI: ${uri}`
            );
        }
      } catch (error) {
        logger.error(`Error reading resource ${uri}:`, error);

        if (error instanceof McpError) {
          throw error;
        }

        throw new McpError(
          ErrorCode.InternalError,
          `Failed to read resource: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  // Tool Handlers

  /**
   * Handles dice rolling requests using FoundryVTT's dice system
   * @param args - Arguments containing formula and optional reason
   * @returns MCP response with dice roll results
   */
  private async handleRollDice(args: any) {
    const { formula, reason } = args;

    if (!formula || typeof formula !== 'string') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Formula parameter is required and must be a string'
      );
    }

    const result = await this.foundryClient.rollDice(formula, reason);

    return {
      content: [
        {
          type: 'text',
          text: `🎲 Rolled ${formula}: **${result.total}**\n\nBreakdown: ${result.breakdown}\n${reason ? `Reason: ${reason}` : ''}`,
        },
      ],
    };
  }

  /**
   * Handles actor search requests
   * @param args - Search parameters including query, type, and limit
   * @returns MCP response with matching actors
   */
  private async handleSearchActors(args: any) {
    const { query, type, limit = 10 } = args;

    try {
      const actors = await this.foundryClient.searchActors({
        query,
        type,
        limit: Math.min(limit, 50), // Cap at 50 for performance
      });

      if (actors.actors.length === 0) {
        // Use diagnostic system to provide helpful guidance
        const diagnostic = await this.diagnosticSystem.diagnoseFeatureProblem('actors');
        
        return {
          content: [
            {
              type: 'text',
              text: `🔍 **No actors found**${query ? ` matching "${query}"` : ''}\n\n` +
                    `**${diagnostic.explanation}**\n\n` +
                    `**💡 Solutions:**\n${diagnostic.suggestions}\n\n` +
                    `${diagnostic.canContinue ? '✅ You can continue using other features while resolving this.' : '⚠️ This issue needs to be resolved for actor search to work.'}\n\n` +
                    `📚 **Need help?** See: ${diagnostic.documentationUrl || 'SETUP_GUIDE.md'}`,
            },
          ],
        };
      }

      const actorList = actors.actors.map(actor =>
        `• **${actor.name}** (${actor.type}) - HP: ${actor.hp?.value || 'N/A'}/${actor.hp?.max || 'N/A'}`
      ).join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `🎭 **Found ${actors.actors.length} actor${actors.actors.length === 1 ? '' : 's'}:**\n\n${actorList}\n\n` +
                  `${actors.total > actors.actors.length ? `📊 Showing ${actors.actors.length} of ${actors.total} total actors` : ''}`,
          },
        ],
      };
    } catch (error) {
      logger.error('Actor search failed:', error);
      
      // Provide diagnostic information for the error
      const diagnostic = await this.diagnosticSystem.diagnoseFeatureProblem('actors');
      
      return {
        content: [
          {
            type: 'text',
            text: `❌ **Actor search failed**\n\n` +
                  `**Issue:** ${diagnostic.explanation}\n\n` +
                  `**Solutions:**\n${diagnostic.suggestions}\n\n` +
                  `**Technical details:** ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
                  `📚 **Troubleshooting guide:** ${diagnostic.documentationUrl || 'SETUP_GUIDE.md'}`,
          },
        ],
      };
    }
  }

  /**
   * Handles detailed actor information requests
   * @param args - Arguments containing actorId
   * @returns MCP response with detailed actor information
   */
  private async handleGetActorDetails(args: any) {
    const { actorId } = args;

    if (!actorId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Actor ID is required'
      );
    }

    const actor = await this.foundryClient.getActor(actorId);

    return {
      content: [
        {
          type: 'text',
          text: `**${actor.name}** (${actor.type})\n\n` +
                `**HP**: ${actor.hp?.value || 'N/A'}/${actor.hp?.max || 'N/A'}\n` +
                `**AC**: ${actor.ac?.value || 'N/A'}\n` +
                `**Level**: ${actor.level || 'N/A'}\n\n` +
                `**Abilities**:\n${this.formatAbilities(actor.abilities)}\n\n` +
                `**Skills**: ${this.formatSkills(actor.skills)}\n\n` +
                `${actor.biography || 'No biography available.'}`,
        },
      ],
    };
  }

  /**
   * Handles item search requests
   * @param args - Search parameters including query, type, rarity, and limit
   * @returns MCP response with matching items
   */
  private async handleSearchItems(args: any) {
    const { query, type, rarity, limit = 10 } = args;

    try {
      const items = await this.foundryClient.searchItems({
        query,
        type,
        rarity,
        limit: Math.min(limit, 50),
      });

      if (items.items.length === 0) {
        // Use diagnostic system to provide helpful guidance
        const diagnostic = await this.diagnosticSystem.diagnoseFeatureProblem('items');
        
        return {
          content: [
            {
              type: 'text',
              text: `🎒 **No items found**${query ? ` matching "${query}"` : ''}${type ? ` of type "${type}"` : ''}${rarity ? ` with rarity "${rarity}"` : ''}\n\n` +
                    `**${diagnostic.explanation}**\n\n` +
                    `**💡 Solutions:**\n${diagnostic.suggestions}\n\n` +
                    `${diagnostic.canContinue ? '✅ You can continue using other features while resolving this.' : '⚠️ This issue needs to be resolved for item search to work.'}\n\n` +
                    `📚 **Need help?** See: ${diagnostic.documentationUrl || 'SETUP_GUIDE.md'}`,
            },
          ],
        };
      }

      const itemList = items.items.map(item =>
        `• **${item.name}** (${item.type})${item.rarity ? ` - ${item.rarity}` : ''}${item.price ? ` - ${item.price.value} ${item.price.denomination || 'gp'}` : ''}`
      ).join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `🗡️ **Found ${items.items.length} item${items.items.length === 1 ? '' : 's'}:**\n\n${itemList}\n\n` +
                  `${items.total > items.items.length ? `📊 Showing ${items.items.length} of ${items.total} total items` : ''}` +
                  `${query || type || rarity ? '\n\n💡 **Tip:** Remove filters to see more items' : ''}`,
          },
        ],
      };
    } catch (error) {
      logger.error('Item search failed:', error);
      
      // Provide diagnostic information for the error
      const diagnostic = await this.diagnosticSystem.diagnoseFeatureProblem('items');
      
      return {
        content: [
          {
            type: 'text',
            text: `❌ **Item search failed**\n\n` +
                  `**Issue:** ${diagnostic.explanation}\n\n` +
                  `**Solutions:**\n${diagnostic.suggestions}\n\n` +
                  `**Technical details:** ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
                  `📚 **Troubleshooting guide:** ${diagnostic.documentationUrl || 'SETUP_GUIDE.md'}`,
          },
        ],
      };
    }
  }

  /**
   * Handles scene information requests
   * @param args - Arguments containing optional sceneId
   * @returns MCP response with scene information
   */
  private async handleGetSceneInfo(args: any) {
    const { sceneId } = args;

    const scene = await this.foundryClient.getCurrentScene(sceneId);

    return {
      content: [
        {
          type: 'text',
          text: `**Scene: ${scene.name}**\n\n` +
                `Dimensions: ${scene.width}x${scene.height}\n` +
                `Background: ${scene.background || 'None'}\n` +
                `Grid Size: ${scene.grid?.size || 'Default'}\n` +
                `Active: ${scene.active ? 'Yes' : 'No'}\n\n` +
                `${scene.description || 'No description available.'}`,
        },
      ],
    };
  }

  /**
   * Handles NPC generation requests
   * @param args - Generation parameters including race, level, role, alignment
   * @returns MCP response with generated NPC details
   */
  private async handleGenerateNPC(args: any) {
    const { race, level, role, alignment } = args;

    const npc = await this.generateRandomNPC({
      race,
      level: level || this.randomBetween(1, 10),
      role: role || this.pickRandom(['commoner', 'merchant', 'guard', 'noble', 'criminal', 'scholar']),
      alignment: alignment || this.pickRandom([
        'lawful good', 'neutral good', 'chaotic good',
        'lawful neutral', 'neutral', 'chaotic neutral',
        'lawful evil', 'neutral evil', 'chaotic evil'
      ])
    });

    return {
      content: [
        {
          type: 'text',
          text: `🎭 **Generated NPC**\n\n` +
                `**Name**: ${npc.name}\n` +
                `**Race**: ${npc.race}\n` +
                `**Class/Role**: ${npc.class || npc.role}\n` +
                `**Level**: ${npc.level}\n` +
                `**Alignment**: ${alignment || 'Neutral'}\n\n` +
                `**Appearance**: ${npc.appearance}\n\n` +
                `**Personality Traits**:\n${npc.personality.map((t: string) => `• ${t}`).join('\n')}\n\n` +
                `**Motivations**:\n${npc.motivations.map((m: string) => `• ${m}`).join('\n')}\n\n` +
                `**Equipment**: ${npc.equipment?.join(', ') || 'Basic clothing and personal effects'}`,
        },
      ],
    };
  }

  /**
   * Handles loot generation requests
   * @param args - Generation parameters including challengeRating, treasureType, includeCoins
   * @returns MCP response with generated loot
   */
  private async handleGenerateLoot(args: any) {
    const { challengeRating, treasureType = 'individual', includeCoins = true } = args;

    if (!challengeRating || challengeRating < 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Challenge rating must be a positive number'
      );
    }

    const loot = await this.generateTreasure(challengeRating, treasureType, includeCoins);

    return {
      content: [
        {
          type: 'text',
          text: `💰 **Generated Loot (CR ${challengeRating})**\n\n${loot}`,
        },
      ],
    };
  }

  /**
   * Handles rule lookup requests
   * @param args - Lookup parameters including query, category, system
   * @returns MCP response with rule information
   */
  private async handleLookupRule(args: any) {
    const { query, category } = args;

    const ruleInfo = await this.lookupGameRule(query, category);

    return {
      content: [
        {
          type: 'text',
          text: `📖 **Rule Lookup: ${query}**\n\n${ruleInfo}`,
        },
      ],
    };
  }

  /**
   * Handles getting recent logs from FoundryVTT server
   * @param args - Arguments containing log filtering parameters
   * @returns MCP response with log entries
   */
  private async handleGetRecentLogs(args: any) {
    const { lines = 50, level, since, source, includeStack = false } = args;

    try {
      // Check if diagnostics API is available
      const isAvailable = await this.diagnosticsClient.isAvailable();
      if (!isAvailable) {
        return {
          content: [
            {
              type: 'text',
              text: '⚠️ **Diagnostics API Unavailable**\n\nThe FoundryVTT REST API module with diagnostics support is not installed or enabled. Please ensure the module is active and restart FoundryVTT.',
            },
          ],
        };
      }

      const response = await this.diagnosticsClient.getRecentLogs({
        lines,
        level,
        since,
        source,
        includeStack,
      });

      const logText = response.logs.map(log => {
        const levelEmoji = {
          error: '❌',
          warn: '⚠️',
          info: 'ℹ️',
          log: '📝',
          notification: '🔔'
        }[log.level] || '📝';

        const timestamp = new Date(log.timestamp).toLocaleTimeString();
        let entry = `${levelEmoji} **${timestamp}** [${log.level.toUpperCase()}] ${log.message}`;

        if (includeStack && log.stack) {
          entry += `\n\`\`\`\n${log.stack}\n\`\`\``;
        }

        return entry;
      }).join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `📋 **Recent FoundryVTT Logs**\n\n**Total Entries:** ${response.total}\n**Buffer Size:** ${response.bufferSize}/${response.maxBufferSize}\n\n${logText || 'No logs found matching criteria.'}`,
          },
        ],
      };
    } catch (error) {
      logger.error('Error getting recent logs:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to retrieve logs: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Handles searching logs for specific patterns
   * @param args - Arguments containing search pattern and filters
   * @returns MCP response with matching log entries
   */
  private async handleSearchLogs(args: any) {
    const { pattern, timeframe, level, caseSensitive = false } = args;

    if (!pattern) {
      throw new McpError(ErrorCode.InvalidParams, 'Search pattern is required');
    }

    try {
      // Check if diagnostics API is available
      const isAvailable = await this.diagnosticsClient.isAvailable();
      if (!isAvailable) {
        return {
          content: [
            {
              type: 'text',
              text: '⚠️ **Diagnostics API Unavailable**\n\nThe FoundryVTT REST API module with diagnostics support is not installed or enabled.',
            },
          ],
        };
      }

      const response = await this.diagnosticsClient.searchLogs({
        pattern,
        timeframe,
        level,
        caseSensitive,
      });

      const searchResults = response.logs.map(log => {
        const levelEmoji = {
          error: '❌',
          warn: '⚠️',
          info: 'ℹ️',
          log: '📝',
          notification: '🔔'
        }[log.level] || '📝';

        const timestamp = new Date(log.timestamp).toLocaleTimeString();
        return `${levelEmoji} **${timestamp}** [${log.level.toUpperCase()}] ${log.message}`;
      }).join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `🔍 **Log Search Results**\n\n**Pattern:** \`${pattern}\`\n**Matches Found:** ${response.matches}\n**Timeframe:** ${response.searchTimeframe}\n\n${searchResults || 'No matching logs found.'}`,
          },
        ],
      };
    } catch (error) {
      logger.error('Error searching logs:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search logs: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Handles getting system health metrics
   * @param args - Empty arguments object
   * @returns MCP response with system health information
   */
  private async handleGetSystemHealth(_args: any) {
    try {
      // Check if diagnostics API is available
      const isAvailable = await this.diagnosticsClient.isAvailable();
      if (!isAvailable) {
        return {
          content: [
            {
              type: 'text',
              text: '⚠️ **Diagnostics API Unavailable**\n\nThe FoundryVTT REST API module with diagnostics support is not installed or enabled.',
            },
          ],
        };
      }

      const health = await this.diagnosticsClient.getSystemHealth();

      const statusEmoji = {
        healthy: '✅',
        warning: '⚠️',
        critical: '❌'
      }[health.status] || '❓';

      const memoryInfo = health.performance.memory ?
        `**Memory Usage:** ${Math.round(health.performance.memory.heapUsed / 1024 / 1024)}MB / ${Math.round(health.performance.memory.heapTotal / 1024 / 1024)}MB` :
        '**Memory Usage:** Not available';

      const healthText = `${statusEmoji} **System Status: ${health.status.toUpperCase()}**

**Server Information:**
• FoundryVTT Version: ${health.server.foundryVersion}
• System Version: ${health.server.systemVersion}
• World ID: ${health.server.worldId}
${health.server.uptime ? `• Uptime: ${Math.floor(health.server.uptime / 3600)}h ${Math.floor((health.server.uptime % 3600) / 60)}m` : ''}

**Users & Activity:**
• Active Users: ${health.users.active}/${health.users.total}
• GM Users: ${health.users.gm}
• Connected Clients: ${health.performance.connectedClients}

**Modules:**
• Active Modules: ${health.modules.active}/${health.modules.total}

**Performance:**
${memoryInfo}

**Logs & Errors:**
• Recent Errors: ${health.logs.recentErrors}
• Recent Warnings: ${health.logs.recentWarnings}
• Error Rate: ${(health.logs.errorRate * 100).toFixed(1)}%
• Log Buffer: ${health.logs.bufferSize} entries`;

      return {
        content: [
          {
            type: 'text',
            text: `🏥 **FoundryVTT System Health**\n\n${healthText}`,
          },
        ],
      };
    } catch (error) {
      logger.error('Error getting system health:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to retrieve system health: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Handles error diagnosis and provides suggestions
   * @param args - Arguments containing timeframe for analysis
   * @returns MCP response with error analysis and suggestions
   */
  private async handleDiagnoseErrors(args: any) {
    const { timeframe = 3600 } = args;

    try {
      // Check if diagnostics API is available
      const isAvailable = await this.diagnosticsClient.isAvailable();
      if (!isAvailable) {
        return {
          content: [
            {
              type: 'text',
              text: '⚠️ **Diagnostics API Unavailable**\n\nThe FoundryVTT REST API module with diagnostics support is not installed or enabled.',
            },
          ],
        };
      }

      const diagnosis = await this.diagnosticsClient.diagnoseErrors(timeframe);

      const scoreEmoji = diagnosis.healthScore >= 90 ? '🟢' :
                        diagnosis.healthScore >= 70 ? '🟡' :
                        diagnosis.healthScore >= 50 ? '🟠' : '🔴';

      const categoriesText = Object.entries(diagnosis.summary.categories)
        .map(([category, count]) => `• ${category}: ${count}`)
        .join('\n');

      const suggestionsText = diagnosis.suggestions
        .map(suggestion => {
          const priorityEmoji = {
            low: '🔵',
            medium: '🟡',
            high: '🟠',
            critical: '🔴'
          }[suggestion.priority] || '⚪';

          return `${priorityEmoji} **${suggestion.category}** (${suggestion.priority}): ${suggestion.suggestion}`;
        })
        .join('\n\n');

      const recentErrorsText = diagnosis.recentErrors.slice(-5)
        .map(error => {
          const timestamp = new Date(error.timestamp).toLocaleTimeString();
          return `❌ **${timestamp}**: ${error.message}`;
        })
        .join('\n');

      const diagnosisText = `${scoreEmoji} **Health Score: ${diagnosis.healthScore}/100**

**Error Summary (${diagnosis.timeframe}):**
• Total Errors: ${diagnosis.summary.totalErrors}
• Unique Errors: ${diagnosis.summary.uniqueErrors}

**Error Categories:**
${categoriesText || 'No errors categorized'}

**Diagnostic Suggestions:**
${suggestionsText || 'No specific suggestions available'}

**Recent Errors:**
${recentErrorsText || 'No recent errors found'}`;

      return {
        content: [
          {
            type: 'text',
            text: `🔬 **FoundryVTT Error Diagnosis**\n\n${diagnosisText}`,
          },
        ],
      };
    } catch (error) {
      logger.error('Error diagnosing errors:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to diagnose errors: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Handles health status requests
   * @param args - Arguments containing detailed flag
   * @returns MCP response with comprehensive health information
   */
  private async handleGetHealthStatus(args: any) {
    const { detailed = true } = args;

    try {
      // Perform comprehensive health check
      const healthReport = await this.diagnosticSystem.performHealthCheck();
      
      // Format the health report for display
      const formattedReport = this.diagnosticSystem.formatHealthReport(healthReport);
      
      let responseText = formattedReport;
      
      if (detailed) {
        // Add additional diagnostic information
        responseText += '\n\n🔧 **Quick Diagnostic Commands:**\n';
        responseText += '• Test connection: `npm run test-connection`\n';
        responseText += '• Check configuration: Review your .env file\n';
        responseText += '• View logs: Check FoundryVTT console for errors\n';
        responseText += '• Module status: Verify REST API module is enabled\n\n';
        
        // Add configuration summary
        responseText += '⚙️ **Current Configuration:**\n';
        responseText += `• Server URL: ${config.foundry.url}\n`;
        responseText += `• Authentication: ${config.foundry.apiKey ? 'API Key' : 'Username/Password'}\n`;
        responseText += `• Timeout: ${config.foundry.timeout}ms\n`;
        responseText += `• Retry Attempts: ${config.foundry.retryAttempts}\n`;
        
        // Add feature recommendations
        if (!healthReport.restApiAvailable) {
          responseText += '\n\n🚀 **Recommended Next Steps:**\n';
          responseText += '1. **Install REST API Module**: Download from FoundryVTT module browser\n';
          responseText += '2. **Enable Module**: Activate in your world settings\n';
          responseText += '3. **Generate API Key**: Configure in module settings\n';
          responseText += '4. **Update Configuration**: Add API key to .env file\n';
          responseText += '5. **Restart Services**: Restart both FoundryVTT and MCP server\n';
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
      };
    } catch (error) {
      logger.error('Health check failed:', error);
      
      return {
        content: [
          {
            type: 'text',
            text: `❌ **Health Check Failed**\n\n` +
                  `Unable to perform health diagnostics due to an error:\n\n` +
                  `**Error:** ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
                  `**Basic Troubleshooting:**\n` +
                  `• Ensure FoundryVTT is running and accessible\n` +
                  `• Check your .env configuration file\n` +
                  `• Verify network connectivity\n` +
                  `• Try restarting the MCP server\n\n` +
                  `📚 **Need help?** See: TROUBLESHOOTING.md`,
          },
        ],
      };
    }
  }

  // Resource Handlers

  /**
   * Reads a specific actor resource
   * @param actorId - The ID of the actor to read
   * @returns Resource contents with actor data
   */
  private async readActorResource(actorId: string) {
    try {
      const actor = await this.foundryClient.getActor(actorId);

      return {
        contents: [
          {
            uri: `foundry://actors/${actorId}`,
            mimeType: 'application/json',
            text: JSON.stringify(actor, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.createErrorResource(`foundry://actors/${actorId}`, 'Failed to retrieve actor', error);
    }
  }

  /**
   * Reads all actors resource
   * @returns Resource contents with all actors data
   */
  private async readAllActorsResource() {
    try {
      const actors = await this.foundryClient.searchActors({ limit: 100 });

      const summary = {
        total: actors.total,
        actors: actors.actors.map(actor => ({
          id: actor._id,
          name: actor.name,
          type: actor.type,
          level: actor.level,
          hp: actor.hp
        })),
        lastUpdated: new Date().toISOString()
      };

      return {
        contents: [
          {
            uri: 'foundry://world/actors',
            mimeType: 'application/json',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.createErrorResource('foundry://world/actors', 'Failed to retrieve actors', error);
    }
  }

  /**
   * Reads all items resource
   * @returns Resource contents with all items data
   */
  private async readAllItemsResource() {
    try {
      const items = await this.foundryClient.searchItems({ limit: 100 });

      const summary = {
        total: items.total,
        items: items.items.map(item => ({
          id: item._id,
          name: item.name,
          type: item.type,
          rarity: item.rarity,
          price: item.price
        })),
        lastUpdated: new Date().toISOString()
      };

      return {
        contents: [
          {
            uri: 'foundry://world/items',
            mimeType: 'application/json',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.createErrorResource('foundry://world/items', 'Failed to retrieve items', error);
    }
  }

  /**
   * Reads all scenes resource
   * @returns Resource contents with scenes data
   */
  private async readAllScenesResource() {
    return {
      contents: [
        {
          uri: 'foundry://world/scenes',
          mimeType: 'application/json',
          text: JSON.stringify({
            message: 'Scene listing requires additional API integration',
            note: 'Use get_scene_info tool for current scene information',
            lastUpdated: new Date().toISOString()
          }, null, 2),
        },
      ],
    };
  }

  /**
   * Reads current scene resource
   * @returns Resource contents with current scene data
   */
  private async readCurrentSceneResource() {
    try {
      const scene = await this.foundryClient.getCurrentScene();

      return {
        contents: [
          {
            uri: 'foundry://scene/current',
            mimeType: 'application/json',
            text: JSON.stringify({
              scene,
              metadata: {
                accessedAt: new Date().toISOString(),
                hasLocalRestApi: !!(this.foundryClient as any).config?.apiKey
              }
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.createErrorResource('foundry://scene/current', 'Failed to retrieve current scene', error);
    }
  }

  /**
   * Reads game settings resource
   * @returns Resource contents with game settings
   */
  private async readGameSettingsResource() {
    return {
      contents: [
        {
          uri: 'foundry://settings/game',
          mimeType: 'application/json',
          text: JSON.stringify({
            serverUrl: (this.foundryClient as any).config?.baseUrl,
            connectionMethod: (this.foundryClient as any).config?.apiKey ? 'Local REST API' : 'WebSocket',
            lastConnected: new Date().toISOString(),
            features: {
              localRestApi: !!(this.foundryClient as any).config?.apiKey,
              webSocket: true,
              dataAccess: (this.foundryClient as any).config?.apiKey ? 'Full' : 'Limited'
            }
          }, null, 2),
        },
      ],
    };
  }

  /**
   * Reads scene resource by ID
   * @param sceneId - The ID of the scene to read
   * @returns Resource contents with scene data
   */
  private async readSceneResource(sceneId: string) {
    try {
      const scene = await this.foundryClient.getScene(sceneId);

      return {
        contents: [
          {
            uri: `foundry://scenes/${sceneId}`,
            mimeType: 'application/json',
            text: JSON.stringify(scene, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.createErrorResource(`foundry://scenes/${sceneId}`, 'Failed to retrieve scene', error);
    }
  }

  /**
   * Reads compendium resource by type
   * @param compendiumType - Type of compendium (spells, monsters, items)
   * @returns Resource contents with compendium data
   */
  private async readCompendiumResource(compendiumType: string) {
    const compendiumData = {
      spells: this.generateSpellCompendium(),
      monsters: this.generateMonsterCompendium(),
      items: this.generateItemCompendium()
    };

    const data = (compendiumData as any)[compendiumType] || {
      error: `Unknown compendium type: ${compendiumType}`,
      available: Object.keys(compendiumData)
    };

    return {
      contents: [
        {
          uri: `foundry://compendium/${compendiumType}`,
          mimeType: 'application/json',
          text: JSON.stringify({
            type: compendiumType,
            data,
            note: 'Compendium data is generated from common RPG resources',
            lastUpdated: new Date().toISOString()
          }, null, 2),
        },
      ],
    };
  }

  // Helper Methods

  /**
   * Formats actor abilities for display
   * @param abilities - Actor abilities object
   * @returns Formatted abilities string
   */
  private formatAbilities(abilities: any): string {
    if (!abilities) {
      return 'No ability scores available';
    }

    return Object.entries(abilities)
      .map(([key, ability]: [string, any]) =>
        `${key.toUpperCase()}: ${ability.value || 'N/A'} (${ability.mod >= 0 ? '+' : ''}${ability.mod || 0})`
      ).join(', ');
  }

  /**
   * Formats actor skills for display
   * @param skills - Actor skills object
   * @returns Formatted skills string
   */
  private formatSkills(skills: any): string {
    if (!skills) {
      return 'No skills available';
    }

    const proficientSkills = Object.entries(skills)
      .filter(([_, skill]: [string, any]) => skill.proficient)
      .map(([name, skill]: [string, any]) =>
        `${name} ${skill.mod >= 0 ? '+' : ''}${skill.mod}`
      );

    return proficientSkills.length > 0 ? proficientSkills.join(', ') : 'No proficient skills';
  }

  /**
   * Creates an error resource response
   * @param uri - Resource URI
   * @param message - Error message
   * @param error - Error object
   * @returns Error resource response
   */
  private createErrorResource(uri: string, message: string, error: any) {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            error: message,
            details: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
            suggestion: 'Check connection settings and ensure FoundryVTT is accessible'
          }, null, 2),
        },
      ],
    };
  }

  // Content Generation Methods

  /**
   * Generates a random NPC with personality and stats
   * @param params - Generation parameters
   * @returns Generated NPC object
   */
  private async generateRandomNPC(params: {
    race?: string;
    level: number;
    role: string;
    alignment?: string;
  }): Promise<any> {
    const races = ['Human', 'Elf', 'Dwarf', 'Halfling', 'Gnome', 'Half-elf', 'Half-orc', 'Tiefling', 'Dragonborn'];
    const names = {
      Human: ['Aiden', 'Bella', 'Connor', 'Diana', 'Elena', 'Finn', 'Grace', 'Hugo'],
      Elf: ['Aelar', 'Berrian', 'Carric', 'Dayereth', 'Enna', 'Galinndan', 'Heian', 'Immeral'],
      Dwarf: ['Adrik', 'Baern', 'Darrak', 'Eberk', 'Fargrim', 'Gardain', 'Harbek', 'Kildrak'],
      Halfling: ['Alton', 'Beau', 'Cade', 'Eldon', 'Garret', 'Lyle', 'Milo', 'Osborn'],
      Gnome: ['Alston', 'Alvyn', 'Brocc', 'Burgell', 'Dimble', 'Eldon', 'Erky', 'Fonkin'],
      default: ['Alex', 'Brook', 'Casey', 'Drew', 'Emery', 'Finley', 'Harper', 'Jamie']
    };

    const selectedRace = params.race || this.pickRandom(races);
    const raceNames = (names as any)[selectedRace] || names.default;

    const personalityTraits = [
      'Speaks in whispers and seems nervous',
      'Always fidgets with a small trinket',
      'Has an infectious laugh',
      'Never makes direct eye contact',
      'Constantly adjusts their clothing',
      'Speaks very loudly and dramatically',
      'Has a habit of humming while working',
      'Always seems to be in a hurry',
      'Very methodical and precise in everything',
      'Tells elaborate stories about the past'
    ];

    const motivations = [
      'Wants to provide for their family',
      'Seeks adventure and excitement',
      'Hopes to prove themselves worthy',
      'Trying to escape a troubled past',
      'Dedicated to serving their community',
      'Pursuing knowledge and learning',
      'Building wealth and influence',
      'Protecting something precious',
      'Seeking revenge for past wrongs',
      'Following religious or spiritual calling'
    ];

    const appearances = [
      'tall and lean with weathered hands',
      'short and stocky with kind eyes',
      'average height with distinctive scars',
      'imposing figure with graying hair',
      'youthful appearance despite their age',
      'elegant bearing with fine clothes',
      'rough around the edges but honest face',
      'mysterious air with hidden depths',
      'cheerful demeanor and bright smile',
      'serious expression but warm heart'
    ];

    const equipment = {
      merchant: ['ledger', 'coin purse', 'trade goods', 'traveler\'s clothes'],
      guard: ['spear', 'chain shirt', 'shield', 'guard uniform'],
      noble: ['fine clothes', 'signet ring', 'perfume', 'silk handkerchief'],
      commoner: ['simple clothes', 'belt pouch', 'work tools'],
      criminal: ['dark cloak', 'lockpicks', 'dagger', 'stolen trinket'],
      scholar: ['books', 'quill and ink', 'reading glasses', 'robes']
    };

    return {
      name: this.pickRandom(raceNames),
      race: selectedRace,
      level: params.level,
      role: params.role,
      class: params.role === 'guard' ? 'Fighter' :
             params.role === 'scholar' ? 'Wizard' :
             params.role === 'criminal' ? 'Rogue' : 'Commoner',
      appearance: this.pickRandom(appearances),
      personality: this.pickRandomMultiple(personalityTraits, 2),
      motivations: this.pickRandomMultiple(motivations, 2),
      equipment: (equipment as any)[params.role] || equipment.commoner
    };
  }

  /**
   * Generates treasure based on challenge rating
   * @param challengeRating - CR to base treasure on
   * @param treasureType - Type of treasure
   * @param includeCoins - Whether to include coins
   * @returns Generated treasure description
   */
  private async generateTreasure(challengeRating: number, treasureType: string, includeCoins: boolean): Promise<string> {
    let treasure = '';

    if (includeCoins) {
      const baseCopper = Math.floor(Math.random() * 100) + challengeRating * 10;
      const baseSilver = Math.floor(Math.random() * 50) + challengeRating * 5;
      const baseGold = Math.floor(Math.random() * 20) + challengeRating * 2;
      const platinum = challengeRating >= 5 ? Math.floor(Math.random() * 10) : 0;

      treasure += `**Coins**:\n• ${baseCopper} copper pieces\n• ${baseSilver} silver pieces\n• ${baseGold} gold pieces${platinum > 0 ? `\n• ${platinum} platinum pieces` : ''}\n\n`;
    }

    if (treasureType === 'hoard' || challengeRating >= 5) {
      const magicItems = ['Potion of Healing', 'Scroll of Identify', 'Cloak of Elvenkind'];
      treasure += `**Magic Items**:\n${this.pickRandomMultiple(magicItems, Math.min(2, magicItems.length)).map(i => `• ${i}`).join('\n')}\n\n`;
    }

    const mundaneItems = ['Silk rope (50 feet)', 'Grappling hook', 'Lantern and oil', 'Trail rations'];
    treasure += `**Equipment & Supplies**:\n${this.pickRandomMultiple(mundaneItems, 3).map(i => `• ${i}`).join('\n')}`;

    return treasure;
  }

  /**
   * Looks up game rules and mechanics
   * @param query - Rule query
   * @param category - Optional category
   * @returns Rule information
   */
  private async lookupGameRule(query: string, _category?: string): Promise<string> {
    const commonRules = {
      'grappling': 'To grapple, make an Athletics check contested by the target\'s Athletics or Acrobatics. Success restrains the target.',
      'opportunity attack': 'When a creature moves out of your reach, you can use your reaction to make one melee attack.',
      'advantage': 'Roll two d20s and use the higher result when you have advantage on a roll.',
      'disadvantage': 'Roll two d20s and use the lower result when you have disadvantage on a roll.',
      'concentration': 'Some spells require concentration. You lose concentration if you take damage and fail a Constitution save (DC 10 or half damage, whichever is higher).',
      'cover': 'Half cover: +2 AC and Dex saves. Three-quarters cover: +5 AC and Dex saves. Total cover: Can\'t be targeted.',
    };

    const lowerQuery = query.toLowerCase();

    for (const [rule, description] of Object.entries(commonRules)) {
      if (lowerQuery.includes(rule) || rule.includes(lowerQuery)) {
        return `**${rule.charAt(0).toUpperCase() + rule.slice(1)}**\n\n${description}\n\n*For complete rules, consult your game system's rulebook.*`;
      }
    }

    return `Rule information for "${query}" not found in quick reference.\n\n` +
           `💡 **Suggestion**: Check your game system's official rulebook or online resources for detailed rule information.`;
  }

  /**
   * Generates spell compendium data
   * @returns Spell compendium object
   */
  private generateSpellCompendium() {
    return {
      cantrips: [
        { name: 'Fire Bolt', school: 'Evocation', damage: '1d10 fire' },
        { name: 'Mage Hand', school: 'Transmutation', range: '30 feet' },
        { name: 'Minor Illusion', school: 'Illusion', duration: '1 minute' }
      ],
      level1: [
        { name: 'Magic Missile', school: 'Evocation', damage: '3d4+3 force' },
        { name: 'Shield', school: 'Abjuration', duration: '1 round' },
        { name: 'Healing Word', school: 'Evocation', healing: '1d4+mod' }
      ],
      note: 'Simplified spell list for demonstration. Full spell details require game system integration.'
    };
  }

  /**
   * Generates monster compendium data
   * @returns Monster compendium object
   */
  private generateMonsterCompendium() {
    return {
      cr_0_1: [
        { name: 'Goblin', cr: '1/4', hp: 7, ac: 15, type: 'humanoid' },
        { name: 'Wolf', cr: '1/4', hp: 11, ac: 13, type: 'beast' },
        { name: 'Skeleton', cr: '1/4', hp: 13, ac: 13, type: 'undead' }
      ],
      cr_1_5: [
        { name: 'Orc', cr: 1, hp: 15, ac: 13, type: 'humanoid' },
        { name: 'Brown Bear', cr: 1, hp: 34, ac: 11, type: 'beast' },
        { name: 'Owlbear', cr: 3, hp: 59, ac: 13, type: 'monstrosity' }
      ],
      note: 'Monster stats are approximate. Consult official sources for complete stat blocks.'
    };
  }

  /**
   * Generates item compendium data
   * @returns Item compendium object
   */
  private generateItemCompendium() {
    return {
      weapons: [
        { name: 'Longsword', type: 'weapon', damage: '1d8 slashing', price: '15 gp' },
        { name: 'Shortbow', type: 'weapon', damage: '1d6 piercing', range: '80/320' },
        { name: 'Dagger', type: 'weapon', damage: '1d4 piercing', properties: ['finesse', 'light'] }
      ],
      armor: [
        { name: 'Leather Armor', type: 'armor', ac: '11 + Dex mod', price: '10 gp' },
        { name: 'Chain Mail', type: 'armor', ac: 16, price: '75 gp' },
        { name: 'Plate Armor', type: 'armor', ac: 18, price: '1,500 gp' }
      ],
      note: 'Equipment list represents common RPG items. Specific stats may vary by game system.'
    };
  }

  // Utility Methods

  /**
   * Picks a random element from an array
   * @param array - Array to pick from
   * @returns Random element
   */
  private pickRandom<T>(array: T[]): T {
    const result = array[Math.floor(Math.random() * array.length)];
    if (result === undefined) {
      throw new Error('Array is empty or invalid index');
    }
    return result;
  }

  /**
   * Picks multiple random elements from an array
   * @param array - Array to pick from
   * @param count - Number of elements to pick
   * @returns Array of random elements
   */
  private pickRandomMultiple<T>(array: T[], count: number): T[] {
    const shuffled = [...array].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(count, array.length));
  }

  /**
   * Generates a random number between min and max (inclusive)
   * @param min - Minimum value
   * @param max - Maximum value
   * @returns Random number
   */
  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Logs startup diagnostic results
   * @private
   */
  private logStartupDiagnostics(healthReport: any): void {
    logger.info(`🔗 Connection: ${healthReport.connectivity.status.toUpperCase()} ${healthReport.connectivity.emoji}`);
    logger.info(`🔐 Authentication: ${healthReport.authentication.method.toUpperCase()} ${healthReport.authentication.emoji}`);
    
    if (healthReport.authentication.status === 'invalid') {
      logger.warn('   ⚠️ Authentication failed - some features may be limited');
    }
    
    logger.info(`🏪 REST API Module: ${healthReport.restApiAvailable ? '✅ Available' : '❌ Not detected'}`);
    
    if (healthReport.connectivity.status === 'limited') {
      logger.warn('   ⚠️ Limited functionality - REST API module recommended for full features');
    }
  }

  /**
   * Logs feature availability summary
   * @private
   */
  private logFeatureSummary(healthReport: any): void {
    const features = healthReport.features;
    
    logger.info('\n📊 Feature Availability:');
    logger.info(`   🎲 Dice Rolling: ${features.diceRolling ? '✅' : '❌'}`);
    logger.info(`   🎭 Actor Search: ${features.actorSearch ? '✅ Full' : '⚠️ Limited'}`);
    logger.info(`   🗡️ Item Search: ${features.itemSearch ? '✅ Full' : '⚠️ Limited'}`);
    logger.info(`   🗺️ Scene Data: ${features.sceneData ? '✅ Real-time' : '⚠️ Mock data'}`);
    logger.info(`   🏥 Diagnostics: ${features.diagnostics ? '✅' : '❌'}`);
    
    const workingFeatures = Object.values(features).filter(Boolean).length;
    const totalFeatures = Object.keys(features).length;
    
    if (workingFeatures === totalFeatures) {
      logger.info(`\n🎉 All ${totalFeatures} features operational!`);
    } else {
      logger.info(`\n📈 ${workingFeatures}/${totalFeatures} features operational`);
    }
  }

  /**
   * Starts the MCP server and connects to FoundryVTT
   */
  async start(): Promise<void> {
    const startTime = Date.now();
    logger.info('🚀 Starting FoundryVTT MCP Server...');
    logger.info(`📋 Configuration: ${config.foundry.url} (${config.foundry.apiKey ? 'API Key' : 'Credentials'})`);

    try {
      // Perform comprehensive startup diagnostics
      logger.info('🔍 Running startup diagnostics...');
      const healthReport = await this.diagnosticSystem.performHealthCheck();
      
      // Log diagnostic results
      this.logStartupDiagnostics(healthReport);
      
      // Determine if we can continue based on health check
      if (healthReport.connectivity.status === 'offline') {
        logger.error('❌ Cannot start: FoundryVTT is not accessible');
        logger.error(`   ${healthReport.connectivity.details}`);
        logger.error('\n🔧 Troubleshooting:');
        logger.error('   1. Ensure FoundryVTT is running');
        logger.error('   2. Check FOUNDRY_URL in your .env file');
        logger.error('   3. Verify network connectivity');
        process.exit(1);
      }

      // Start MCP transport
      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      const startupTime = Date.now() - startTime;
      logger.info(`✅ FoundryVTT MCP Server running (${config.serverName} v${config.serverVersion})`);
      logger.info(`⚡ Startup completed in ${startupTime}ms`);
      
      // Log feature availability summary
      this.logFeatureSummary(healthReport);
      
      // Show helpful tips for improved functionality
      if (!healthReport.restApiAvailable) {
        logger.info('\n💡 Enhanced Features Available:');
        logger.info('   Install the "Foundry Local REST API" module for:');
        logger.info('   • Full actor and item search capabilities');
        logger.info('   • Real-time scene data access');
        logger.info('   • System health monitoring and diagnostics');
        logger.info('   📚 Setup guide: https://github.com/laurigates/foundryvtt-mcp#setup');
      }

    } catch (error) {
      logger.error('❌ Failed to start server:', error);
      
      if (error instanceof Error) {
        // Provide specific guidance based on error type
        if (error.message.includes('ECONNREFUSED')) {
          logger.error('\n🔧 Connection Refused - FoundryVTT may not be running');
          logger.error('   1. Start FoundryVTT server');
          logger.error('   2. Ensure it\'s accessible at the configured URL');
          logger.error(`   3. Test manually: ${config.foundry.url}`);
        } else if (error.message.includes('ENOTFOUND')) {
          logger.error('\n🔧 Host Not Found - Check your URL configuration');
          logger.error('   1. Verify FOUNDRY_URL in .env file');
          logger.error('   2. Check DNS resolution');
          logger.error('   3. Ensure no typos in hostname');
        } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
          logger.error('\n🔧 Authentication Failed');
          logger.error('   1. Check API key or username/password');
          logger.error('   2. Verify user has required permissions');
          logger.error('   3. Try regenerating API key in FoundryVTT');
        }
      }
      
      logger.error('\n📚 For detailed troubleshooting: TROUBLESHOOTING.md');
      process.exit(1);
    }
  }

  /**
   * Gracefully shuts down the server
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down FoundryVTT MCP Server...');
    await this.foundryClient.disconnect();
    process.exit(0);
  }
}

// Handle graceful shutdown
const server = new FoundryMCPServer();

process.on('SIGINT', () => server.shutdown());
process.on('SIGTERM', () => server.shutdown());

// Start the server
server.start().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
