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
      useRestModule: config.foundry.useRestModule,
      apiKey: config.foundry.apiKey,
      username: config.foundry.username,
      password: config.foundry.password,
      socketPath: config.foundry.socketPath,
      timeout: config.foundry.timeout,
      retryAttempts: config.foundry.retryAttempts,
      retryDelay: config.foundry.retryDelay,
    });

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
            return await this.readCompendiumResource(compendiumType);
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
    
    const actors = await this.foundryClient.searchActors({
      query,
      type,
      limit: Math.min(limit, 50), // Cap at 50 for performance
    });

    if (actors.actors.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No actors found${query ? ` matching "${query}"` : ''}.\n\n` +
                  `💡 **Tip**: If you're getting empty results, you may need to:\n` +
                  `• Install and configure the "Foundry REST API" module\n` +
                  `• Set USE_REST_MODULE=true in your environment\n` +
                  `• Or search for actors directly in FoundryVTT first`,
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
          text: `Found ${actors.actors.length} actors:\n\n${actorList}`,
        },
      ],
    };
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
    
    const items = await this.foundryClient.searchItems({
      query,
      type,
      rarity,
      limit: Math.min(limit, 50),
    });

    if (items.items.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No items found${query ? ` matching "${query}"` : ''}.\n\n` +
                  `💡 **Tip**: Item searching requires the REST API module for full functionality.`,
          },
        ],
      };
    }

    const itemList = items.items.map(item => 
      `• **${item.name}** (${item.type}) ${item.rarity ? `- ${item.rarity}` : ''}`
    ).join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `Found ${items.items.length} items:\n\n${itemList}`,
        },
      ],
    };
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
                `**Personality Traits**:\n${npc.personality.map(t => `• ${t}`).join('\n')}\n\n` +
                `**Motivations**:\n${npc.motivations.map(m => `• ${m}`).join('\n')}\n\n` +
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
                hasRestApi: this.foundryClient.config?.useRestModule || false
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
            serverUrl: this.foundryClient.config?.baseUrl,
            connectionMethod: this.foundryClient.config?.useRestModule ? 'REST API' : 'WebSocket',
            lastConnected: new Date().toISOString(),
            features: {
              restApi: this.foundryClient.config?.useRestModule || false,
              webSocket: true,
              dataAccess: this.foundryClient.config?.useRestModule ? 'Full' : 'Limited'
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

    const data = compendiumData[compendiumType] || {
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
    const raceNames = names[selectedRace] || names.default;
    
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
      equipment: equipment[params.role] || equipment.commoner
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
    return array[Math.floor(Math.random() * array.length)];
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
   * Starts the MCP server and connects to FoundryVTT
   */
  async start(): Promise<void> {
    logger.info('Starting FoundryVTT MCP Server...');
    
    try {
      // Test connection to FoundryVTT
      await this.foundryClient.testConnection();
      logger.info('✅ Connected to FoundryVTT successfully');
      
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
      logger.info(`🚀 FoundryVTT MCP Server running (${config.serverName} v${config.serverVersion})`);
    } catch (error) {
      logger.error('❌ Failed to start server:', error);
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