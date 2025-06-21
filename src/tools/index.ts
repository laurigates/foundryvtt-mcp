import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const toolDefinitions: Tool[] = [
  // Basic Tools
  {
    name: 'roll_dice',
    description: 'Roll dice using standard RPG notation (1d20, 2d6+3, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        formula: {
          type: 'string',
          description: 'Dice formula in standard notation (e.g., "1d20+5", "3d6", "2d10+1d4")',
          pattern: '^[0-9]+d[0-9]+([+-][0-9]+)*$'
        }
      },
      required: ['formula']
    }
  },

  // Actor Tools
  {
    name: 'search_actors',
    description: 'Search for actors (characters, NPCs) in the world',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for actor name or type'
        },
        type: {
          type: 'string',
          enum: ['character', 'npc', 'all'],
          description: 'Filter by actor type',
          default: 'all'
        },
        page: {
          type: 'number',
          description: 'Page number for pagination',
          minimum: 1,
          default: 1
        },
        limit: {
          type: 'number',
          description: 'Number of results per page',
          minimum: 1,
          maximum: 100,
          default: 10
        }
      }
    }
  },

  // Item Tools
  {
    name: 'search_items',
    description: 'Search for items in the world',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for item name or type'
        },
        type: {
          type: 'string',
          description: 'Filter by item type (weapon, armor, spell, etc.)'
        },
        page: {
          type: 'number',
          description: 'Page number for pagination',
          minimum: 1,
          default: 1
        },
        limit: {
          type: 'number',
          description: 'Number of results per page',
          minimum: 1,
          maximum: 100,
          default: 10
        }
      }
    }
  },

  // Scene Tools
  {
    name: 'get_scenes',
    description: 'Get information about scenes in the world',
    inputSchema: {
      type: 'object',
      properties: {
        active_only: {
          type: 'boolean',
          description: 'Only return the currently active scene',
          default: false
        }
      }
    }
  },

  // World Tools
  {
    name: 'get_world_info',
    description: 'Get basic information about the current world',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];
