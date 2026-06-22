/**
 * @fileoverview Tool definitions for FoundryVTT MCP Server
 *
 * This module contains all tool schema definitions organized by category.
 * Tools are separated into logical groups for better maintainability.
 */

/**
 * Dice rolling tool definitions
 */
export const diceTools = [
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
];

/**
 * Actor management tool definitions
 */
export const actorTools = [
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
];

/**
 * Actor attribute mutation tool definitions (#143)
 *
 * WRITE operations — require FOUNDRY_WRITE_ENABLED=true and an active
 * Socket.IO connection (mutations use the core `modifyDocument` protocol).
 */
export const actorMutationTools = [
  {
    name: 'update_actor_attributes',
    description:
      "Update attributes on an actor's system data. The patch keys are dot-paths into actor.system " +
      '(e.g. "attributes.hp.value", "attributes.hp.temp", "currency.gp", "resources.primary.value", ' +
      '"spells.spell1.value", "attributes.exhaustion"). Returns the post-update value for every patched ' +
      'path. Validates HP <= max + temp, spell slots <= max, and exhaustion within 0-10 (2024) or 0-6 (2014). ' +
      'Requires FOUNDRY_WRITE_ENABLED=true and an active Socket.IO connection.',
    inputSchema: {
      type: 'object',
      properties: {
        actorId: {
          type: 'string',
          description: 'The ID of the actor to update',
        },
        patch: {
          type: 'object',
          description:
            'Map of dot-path → value, where each dot-path addresses a field under actor.system ' +
            '(e.g. {"attributes.hp.value": 30, "currency.gp": 12}). Values must be number, string, or boolean.',
          additionalProperties: {
            type: ['number', 'string', 'boolean'],
          },
        },
      },
      required: ['actorId', 'patch'],
    },
  },
];

/**
 * Item management tool definitions
 */
export const itemTools = [
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
];

/**
 * Compendium search tool definitions (#144)
 */
export const compendiumTools = [
  {
    name: 'search_compendium',
    description:
      'Search FoundryVTT compendium packs by name and metadata. Searches all enabled compendiums by default; the compendiumId filter scopes to one pack. Requires the REST API module (FOUNDRY_API_KEY).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for compendium entry names',
        },
        filters: {
          type: 'object',
          description: 'Optional metadata filters to narrow the search',
          properties: {
            compendiumId: {
              type: 'string',
              description: 'Scope the search to a single compendium pack',
            },
            packType: {
              type: 'string',
              description: 'Pack document type (Item, Actor, JournalEntry, Macro)',
            },
            itemType: {
              type: 'string',
              description: 'Item type filter (spell, weapon, feat, etc.)',
            },
            spellLevel: {
              type: 'number',
              description: 'Spell level filter',
            },
            source: {
              type: 'string',
              description: 'Source/rules filter (e.g. a sourcebook abbreviation)',
            },
          },
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results per page',
          default: 20,
        },
        cursor: {
          type: 'string',
          description:
            'Opaque pagination cursor from a prior result\'s "Next page" cursor; omit for the first page',
        },
      },
      required: ['query'],
    },
  },
];

/**
 * Actor item mutation tool definitions (WRITE — require FOUNDRY_WRITE_ENABLED
 * and an active Socket.IO connection; mutations use `modifyDocument`)
 *
 * The canonical mutation target is the D&D 5e v4+ activity schema. Item
 * `system` patches honour JSON-merge-patch semantics on nested paths.
 */
export const itemMutationTools = [
  {
    name: 'create_actor_item',
    description:
      'Create an item on an actor from an inline item document (requires FOUNDRY_WRITE_ENABLED + active Socket.IO connection). Compendium-source create is not yet supported over Socket.IO (see issue #159). Canonical target: D&D 5e v4+ activity schema.',
    inputSchema: {
      type: 'object',
      properties: {
        actorId: {
          type: 'string',
          description: 'The ID of the actor to add the item to',
        },
        source: {
          type: 'object',
          description:
            'Item source: { type: "compendium", compendiumId, itemId } to copy a compendium entry, or { type: "inline", item: { type, name, system } } to create directly',
          properties: {
            type: {
              type: 'string',
              enum: ['compendium', 'inline'],
              description: 'Source kind',
            },
            compendiumId: {
              type: 'string',
              description: 'Compendium pack id (compendium source)',
            },
            itemId: {
              type: 'string',
              description: 'Item id within the compendium pack (compendium source)',
            },
            item: {
              type: 'object',
              description: 'Inline item document with type, name, and system (inline source)',
            },
          },
          required: ['type'],
        },
      },
      required: ['actorId', 'source'],
    },
  },
  {
    name: 'update_actor_item',
    description:
      "Apply a JSON merge patch to an item's system data on an actor (requires FOUNDRY_WRITE_ENABLED + active Socket.IO connection). Supports nested paths such as activities.{id}.consumption.targets. Canonical target: D&D 5e v4+ activity schema.",
    inputSchema: {
      type: 'object',
      properties: {
        actorId: {
          type: 'string',
          description: 'The ID of the actor that owns the item',
        },
        itemId: {
          type: 'string',
          description: 'The ID of the item to update',
        },
        patch: {
          type: 'object',
          description:
            'JSON merge patch applied to item.system; nested paths supported (e.g. activities.{id}.consumption.targets)',
        },
      },
      required: ['actorId', 'itemId', 'patch'],
    },
  },
  {
    name: 'delete_actor_item',
    description:
      'Delete an item owned by an actor (requires FOUNDRY_WRITE_ENABLED + active Socket.IO connection). Canonical target: D&D 5e v4+ activity schema.',
    inputSchema: {
      type: 'object',
      properties: {
        actorId: {
          type: 'string',
          description: 'The ID of the actor that owns the item',
        },
        itemId: {
          type: 'string',
          description: 'The ID of the item to delete',
        },
      },
      required: ['actorId', 'itemId'],
    },
  },
];

/**
 * Scene management tool definitions
 */
export const sceneTools = [
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
];

/**
 * Content generation tool definitions
 */
export const generationTools = [
  {
    name: 'generate_npc',
    description: 'Generate a random NPC with stats and background',
    inputSchema: {
      type: 'object',
      properties: {
        level: {
          type: 'number',
          description: 'Character level (1-20)',
          minimum: 1,
          maximum: 20,
          default: 1,
        },
        race: {
          type: 'string',
          description: 'Character race (optional)',
        },
        class: {
          type: 'string',
          description: 'Character class (optional)',
        },
      },
    },
  },
  {
    name: 'generate_loot',
    description: 'Generate random loot for encounters',
    inputSchema: {
      type: 'object',
      properties: {
        challengeRating: {
          type: 'number',
          description: 'Challenge rating for loot generation',
          minimum: 0,
          maximum: 30,
        },
        treasureType: {
          type: 'string',
          description: 'Type of treasure (hoard, individual, etc.)',
        },
      },
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
        system: {
          type: 'string',
          description: 'Game system (D&D 5e, Pathfinder, etc.)',
        },
      },
      required: ['query'],
    },
  },
];

/**
 * Diagnostics and logging tool definitions
 */
export const diagnosticsTools = [
  {
    name: 'get_recent_logs',
    description: 'Get recent log entries from FoundryVTT',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of log entries to retrieve',
          default: 20,
          minimum: 1,
          maximum: 100,
        },
        level: {
          type: 'string',
          description: 'Log level filter (debug, info, warn, error)',
          enum: ['debug', 'info', 'warn', 'error'],
        },
        since: {
          type: 'string',
          description: 'Get logs since this timestamp (ISO format)',
        },
      },
    },
  },
  {
    name: 'search_logs',
    description: 'Search through FoundryVTT logs',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for log contents',
        },
        level: {
          type: 'string',
          description: 'Log level filter',
          enum: ['debug', 'info', 'warn', 'error'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results',
          default: 50,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_system_health',
    description: 'Get system health and performance metrics',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'diagnose_errors',
    description:
      'Stub: returns raw logs without analysis. Full diagnostic logic is tracked in #133 and not yet implemented.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Error category to focus on',
        },
      },
    },
  },
  {
    name: 'get_health_status',
    description: 'Get comprehensive health status of FoundryVTT server',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Combat tool definitions
 */
export const combatTools = [
  {
    name: 'get_combat_state',
    description: 'Get the current active combat state including initiative order, HP, and AC',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Combat control mutation tool definitions (FR-018)
 *
 * WRITE operations — require FOUNDRY_WRITE_ENABLED=true and an active Socket.IO
 * connection (mutations use the core `modifyDocument` protocol). All operate on
 * the *active* combat; the connected user needs GM/owner permission.
 */
export const combatMutationTools = [
  {
    name: 'next_turn',
    description:
      'Advance the active combat to the next turn, wrapping to the next round after the last combatant. ' +
      'When skipDefeated is true, defeated combatants are skipped. ' +
      'Requires FOUNDRY_WRITE_ENABLED=true and an active Socket.IO connection.',
    inputSchema: {
      type: 'object',
      properties: {
        skipDefeated: {
          type: 'boolean',
          description:
            "Skip combatants flagged as defeated when advancing. Defaults to the combat's skipDefeated setting, or false.",
        },
      },
    },
  },
  {
    name: 'end_combat',
    description:
      'End (delete) the active combat encounter. ' +
      'Requires FOUNDRY_WRITE_ENABLED=true and an active Socket.IO connection.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_initiative',
    description:
      "Set a combatant's initiative in the active combat. " +
      'Requires FOUNDRY_WRITE_ENABLED=true and an active Socket.IO connection.',
    inputSchema: {
      type: 'object',
      properties: {
        combatantId: {
          type: 'string',
          description: 'The ID of the combatant whose initiative to set',
        },
        initiative: {
          type: 'number',
          description: 'The initiative value to assign',
        },
        combatId: {
          type: 'string',
          description: 'Optional Combat document ID; defaults to the active combat',
        },
      },
      required: ['combatantId', 'initiative'],
    },
  },
  {
    name: 'start_combat',
    description:
      'Start a new combat encounter, seeding combatants from tokens. ' +
      'Provide explicit tokenIds, or omit them to seed every token on the scene. ' +
      'Defaults to the active scene when sceneId is omitted. ' +
      'Requires FOUNDRY_WRITE_ENABLED=true and an active Socket.IO connection (GM permission).',
    inputSchema: {
      type: 'object',
      properties: {
        tokenIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of Token document IDs to add as combatants. Defaults to all tokens on the scene.',
        },
        sceneId: {
          type: 'string',
          description: 'Optional Scene document ID; defaults to the active scene.',
        },
      },
    },
  },
];

/**
 * Token manipulation mutation tool definitions (FR-019)
 *
 * WRITE operations — require FOUNDRY_WRITE_ENABLED=true and an active Socket.IO
 * connection (mutations use the core `modifyDocument` protocol). The connected
 * user needs GM/owner permission.
 */
export const tokenMutationTools = [
  {
    name: 'move_token',
    description:
      'Move a token to new x/y pixel coordinates on its scene. ' +
      'The token is located across scenes by id (optionally scoped with sceneId). ' +
      'Requires FOUNDRY_WRITE_ENABLED=true and an active Socket.IO connection.',
    inputSchema: {
      type: 'object',
      properties: {
        tokenId: {
          type: 'string',
          description: 'The ID of the token to move',
        },
        x: {
          type: 'number',
          description: 'Target x pixel coordinate on the scene',
        },
        y: {
          type: 'number',
          description: 'Target y pixel coordinate on the scene',
        },
        sceneId: {
          type: 'string',
          description: 'Optional Scene ID to scope the token lookup',
        },
      },
      required: ['tokenId', 'x', 'y'],
    },
  },
  {
    name: 'apply_status_effect',
    description:
      "Apply or remove a status condition (e.g. 'prone', 'stunned') on a token's actor. " +
      'Set active=false to remove. Matches by status id, so re-applying or clearing-when-absent is a no-op. ' +
      'Requires FOUNDRY_WRITE_ENABLED=true and an active Socket.IO connection.',
    inputSchema: {
      type: 'object',
      properties: {
        tokenId: {
          type: 'string',
          description: 'The ID of the token whose actor to affect',
        },
        statusId: {
          type: 'string',
          description: "The status condition id (e.g. 'prone', 'stunned', 'blinded')",
        },
        active: {
          type: 'boolean',
          description: 'true to apply the effect (default), false to remove it',
          default: true,
        },
        sceneId: {
          type: 'string',
          description: 'Optional Scene ID to scope the token lookup',
        },
      },
      required: ['tokenId', 'statusId'],
    },
  },
];

/**
 * Chat message tool definitions
 */
export const chatTools = [
  {
    name: 'get_chat_messages',
    description: 'Get recent chat messages from the game',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of messages to retrieve (default 20)',
          default: 20,
          minimum: 1,
          maximum: 100,
        },
      },
    },
  },
];

/**
 * User tool definitions
 */
export const userTools = [
  {
    name: 'get_users',
    description: 'Get the list of users with their online status and roles',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Journal tool definitions
 */
export const journalTools = [
  {
    name: 'search_journals',
    description: 'Search journal entries by name or content',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for journal names and content',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results',
          default: 10,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_journal',
    description: 'Get a specific journal entry with its pages',
    inputSchema: {
      type: 'object',
      properties: {
        journalId: {
          type: 'string',
          description: 'The ID of the journal entry to retrieve',
        },
      },
      required: ['journalId'],
    },
  },
];

/**
 * World-level tool definitions
 */
export const worldTools = [
  {
    name: 'search_world',
    description: 'Search across all collections (actors, items, scenes, journals) by name',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to match against entity names',
        },
        limit: {
          type: 'number',
          description: 'Maximum results per collection (default 5)',
          default: 5,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_world_summary',
    description: 'Get world metadata and collection counts',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'refresh_world_data',
    description: 'Force re-fetch of world data from the FoundryVTT server',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Get all tool definitions combined
 */
export function getAllTools() {
  return [
    ...diceTools,
    ...actorTools,
    ...actorMutationTools,
    ...itemTools,
    ...compendiumTools,
    ...itemMutationTools,
    ...sceneTools,
    ...combatTools,
    ...combatMutationTools,
    ...tokenMutationTools,
    ...chatTools,
    ...userTools,
    ...journalTools,
    ...worldTools,
    ...generationTools,
    ...diagnosticsTools,
  ];
}

/**
 * Get modernized tool definitions from registry (when available)
 */
export async function getModernizedTools() {
  try {
    const { toolRegistry } = await import('./registry.js');
    const modernTools = toolRegistry.getToolDefinitions();

    // Filter out tools that have been modernized to avoid duplicates
    const modernToolNames = new Set(modernTools.map((tool) => tool.name));
    const legacyTools = getAllTools().filter((tool) => !modernToolNames.has(tool.name));

    return [...modernTools, ...legacyTools];
  } catch (_error) {
    // Fallback to legacy definitions if registry is not available
    return getAllTools();
  }
}
