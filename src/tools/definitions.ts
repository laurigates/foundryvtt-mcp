/**
 * @fileoverview Tool definitions for FoundryVTT MCP Server
 *
 * This module contains all tool schema definitions organized by category.
 * Tools are separated into logical groups for better maintainability.
 */

/**
 * Shared write-safety clause appended to every mutation tool description.
 *
 * Both halves are enforced in code by `assertWriteable()`
 * (`src/foundry/client.ts`): the `FOUNDRY_WRITE_ENABLED` opt-in (default
 * `false`, see `src/config/index.ts`) and a live authenticated Socket.IO
 * session. Foundry itself enforces the GM/owner permission (ADR-010).
 */
const WRITE_GATE =
  'WRITE: mutates the live world. Requires FOUNDRY_WRITE_ENABLED=true (default false) and an active Socket.IO connection, and is refused otherwise; Foundry additionally enforces GM/owner permission on the document.';

/**
 * Extra clause for destructive tools (data removal that this server cannot undo).
 */
const CONFIRM_FIRST =
  'DESTRUCTIVE and not undoable from this server: confirm the exact target with the user before calling.';

/**
 * Canonical `roll_dice` description.
 *
 * Exported so `RollDiceTool` (`src/tools/handlers/dice.ts`) can reuse the exact
 * same string instead of keeping a second copy that silently drifts: the
 * registry class is what *executes* the tool while `getAllTools()` is what is
 * *listed*, so a divergence would be invisible.
 */
export const ROLL_DICE_DESCRIPTION =
  'Roll dice and return the total with a per-term breakdown. Write every term as NdS with any modifier attached directly to it ("1d20+5", "3d6", "2d6 + 1d4"); a count-less "d20", a modifier separated from its term by a space ("1d20 + 5"), a trailing bonus ("1d20+5+3") and parentheses are silently dropped from the total rather than rejected, so a loosely written formula returns a wrong number. Use when: the user asks for a check, save, attack, damage, or any random result.';

/**
 * Dice rolling tool definitions
 */
export const diceTools = [
  {
    name: 'roll_dice',
    description: ROLL_DICE_DESCRIPTION,
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
    description:
      "Search actors (player characters, NPCs) by name, optionally filtered by type. Returns a summary line per match: name, type, level and current/max HP. Use when: checking whether an actor exists, or getting a quick roster with HP. Do not use when: you already have the actorId and want that actor's ability scores - use get_actor_details; or you need the actorId itself, which this tool does not print - read the foundry://actors resource, whose JSON lists up to the first 100 actors with their _id (not exhaustive in larger worlds).",
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
    description:
      'Get details for one actor by id: type, level, current/max HP, AC and ability scores; no biography or description text is returned (the description line always reads "No description available."). Use when: you have an actorId and need its current HP or ability scores - notably as the read-before-write step for update_actor_attributes. Do not use when: you only have a name - run search_actors first; or you need the ids of items the actor owns, which this tool does not return (no tool in this server lists owned-item ids - ask the user for the itemId).',
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
      'Update fields on an actor\'s system data. Patch keys are dot-paths into actor.system (e.g. "attributes.hp.value", "attributes.hp.temp", "currency.gp", "resources.primary.value", "spells.spell1.value", "attributes.exhaustion") and values are absolute target values, never relative deltas. Validates HP <= max + temp, spell slots <= max, and exhaustion within 0-10 (2024) or 0-6 (2014), and returns the post-update value for every patched path. Use when: applying damage or healing, spending a spell slot or resource, or adjusting currency on a known actorId. Do not use when: changing an item the actor owns (use update_actor_item) or only reading current values (use get_actor_details). ' +
      WRITE_GATE,
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
    description:
      'Search item documents in the world by name, optionally filtered by type. Returns name, type and rarity per match (rarity shows "Common" when the system records none); price is not available and always prints "Unknown price", and the rarity filter is ignored unless the REST API module is configured (FOUNDRY_API_KEY). Item ids are not printed - read the foundry://items resource, whose JSON lists up to the first 100 items with their _id (not exhaustive in larger worlds). Use when: checking whether an item exists in the world. Do not use when: searching compendium packs (use search_compendium) or listing what one actor carries (this searches world items, not owned items).',
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
          description:
            'Item rarity filter (common, uncommon, rare, etc.). Applied only in REST API mode (FOUNDRY_API_KEY); ignored on the default Socket.IO path.',
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
      'Search FoundryVTT compendium packs by name and metadata; searches all enabled packs unless compendiumId scopes it to one pack. Use when: looking up spells, monsters, or equipment that are not yet present in the world. Do not use when: the document already exists in the world - use search_items or search_world. Requires the REST API module (FOUNDRY_API_KEY); without it the search returns no results instead of failing.',
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
      'Create an item on an actor from an inline item document (type, name, system). Use when: adding a new weapon, spell, feature, or piece of equipment to a known actorId. Do not use when: editing an item the actor already owns - use update_actor_item. Replacing an item is not atomic: create the replacement first and delete the old one second, so a mid-sequence failure leaves the actor with a duplicate rather than nothing. Compendium-source create is not yet supported over Socket.IO (see issue #159). Canonical target: D&D 5e v4+ activity schema. ' +
      WRITE_GATE,
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
            'Item source. Use { type: "inline", item: { type, name, system } } to create the item directly. The { type: "compendium", compendiumId, itemId } shape is accepted by the schema but rejected at call time - compendium-source create is not yet supported over Socket.IO.',
          properties: {
            type: {
              type: 'string',
              enum: ['compendium', 'inline'],
              description:
                'Source kind. Only "inline" is functional today; "compendium" is rejected at call time.',
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
      "Apply a JSON merge patch to an item's system data on an actor: nested paths such as activities.{id}.consumption.targets are supported, values are absolute (arrays replace, null deletes). Use when: changing fields on an item the actor already owns, given actorId + itemId. Do not use when: adding a new item (create_actor_item) or removing one (delete_actor_item). Canonical target: D&D 5e v4+ activity schema. " +
      WRITE_GATE,
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
      "Permanently remove an item owned by an actor. Use when: the user explicitly asks to delete or discard a specific owned item, and has given you the itemId - no tool in this server lists owned-item ids, so never guess one. Do not use when: only the item's data needs to change - use update_actor_item. In a replacement or migration flow, run create_actor_item first and this second: the two calls are not atomic, and failing after the delete loses the item. Echo the actorId and itemId back to the user and get their confirmation before calling. " +
      CONFIRM_FIRST +
      ' ' +
      WRITE_GATE,
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
    description:
      "Get details of the active scene, or of a specific scene by id: name, scene id, active/navigation flags, pixel dimensions, padding and lighting (global light, darkness); no description text is returned unless a module has set a description flag on the scene (the description line otherwise reads 'No description available.'). Use when: you need the sceneId or the scene's pixel extents. Do not use when: looking a scene up by name (use search_world), or you need grid size or token coordinates - this tool returns neither.",
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
    description:
      'Generate a random NPC (name, race, class, HP, ability scores, background) as text. Use when: the user needs a throwaway NPC on the spot. Do not use when: the NPC must exist in FoundryVTT - this creates no documents, and the result still has to be entered into the world by hand.',
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
    description:
      "Generate random treasure for an encounter as text. Only the currency amounts vary: they scale with the challenge rating, while the item list is fixed (a Healing Potion and a Silver Ring) and the treasureType argument is accepted but not used. Use when: the user wants a quick coin total for an encounter. Do not use when: the loot should end up in an actor's inventory - this creates no documents; use create_actor_item for that.",
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
          description:
            'Type of treasure (hoard, individual, etc.). Accepted but not used - the generated result is the same whichever value is passed.',
        },
      },
    },
  },
  {
    name: 'lookup_rule',
    description:
      'Stub: builds a templated placeholder from the query and consults no rules source, so the text it returns carries no rules content. No tool in this server looks rules up.',
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
    description:
      'Get recent FoundryVTT server log entries, optionally filtered by level or since a timestamp. Use when: investigating an error or recent server behaviour. Do not use when: you have a specific term to look for - use search_logs. Requires the REST API module (FOUNDRY_API_KEY); fails without it.',
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
    description:
      'Search the FoundryVTT server logs for a query string. Use when: hunting a specific error message, stack trace, or module name. Do not use when: you just want the latest entries - use get_recent_logs. Note: the level and limit arguments are accepted but are not applied to the search, and matched entries are not rendered - the result reports 0 results and lists no entries whatever the log contains, so get_recent_logs is currently the only tool that returns log content. Requires the REST API module (FOUNDRY_API_KEY); fails without it.',
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
    description:
      'Get the FoundryVTT server\'s overall health status (healthy, warning, or critical). That status is the only value reported: the output\'s CPU, memory, disk, uptime, connection and performance lines have no counterpart in the diagnostics response schema and always read "N/A". Use when: you want a single healthy/warning/critical verdict for the server. Do not use when: you also want connection and world status - use get_health_status. Requires the REST API module (FOUNDRY_API_KEY); fails without it.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'diagnose_errors',
    description:
      'Stub: returns a fixed "no errors detected" summary regardless of input; real diagnostic logic is not implemented, so the summary reflects nothing about the server. For actual log content use get_recent_logs.',
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
    description:
      'Get a combined health report: MCP-to-FoundryVTT connection state, world title/system/core version, and the server\'s health status. The connection line is the last known state - it is set when the client connects and cleared only by an explicit disconnect, not by a dropped socket, so it is not a live probe. Playtime always reports 0 hours, and the CPU, memory and uptime lines always read "N/A", as the underlying responses carry none of those values. Degrades gracefully - sections that need the REST API module (FOUNDRY_API_KEY) report as unavailable rather than failing. Use when: first checking which world is loaded and whether the server reports itself healthy.',
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
    description:
      "Get the active combat encounter: initiative order with each combatant's name, initiative, HP and AC, plus the current round and which combatant is up. Use when: reporting whose turn it is, or checking whether a combat is already running before start_combat. Do not use when: you need a combatantId for set_initiative - this prints names and ordinals, not ids; read the foundry://combat resource, whose JSON includes each combatant's _id.",
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
      'Advance the active combat to the next turn, wrapping to the next round after the last combatant. When skipDefeated is true, defeated combatants are skipped. Use when: the current combatant has finished their turn. Do not use when: only reporting the turn order - use get_combat_state. ' +
      WRITE_GATE,
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
      'End the active combat encounter by deleting its Combat document, discarding the initiative order and round count. Use when: the fight is over and the user asks to end the encounter. ' +
      CONFIRM_FIRST +
      ' ' +
      WRITE_GATE,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_initiative',
    description:
      "Set a combatant's initiative in the active combat (or in combatId when given), reordering the turn order. Use when: an initiative roll needs to be recorded or corrected for a known combatantId. Do not use when: simply moving on to the next combatant - use next_turn. " +
      WRITE_GATE,
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
      'Start a new combat encounter, seeding combatants from tokens: pass explicit tokenIds, or omit them to seed every token on the scene. Defaults to the active scene when sceneId is omitted. Use when: a fight begins and no combat is running. Do not use when: a combat is already active - check get_combat_state first, since this always creates an additional encounter. ' +
      WRITE_GATE,
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
      "Move a token to new x/y pixel coordinates on its scene; the token is located across scenes by id, optionally scoped with sceneId. Coordinates are absolute pixels, not grid squares and not offsets. Use when: repositioning a token to a position the user has given you. Do not use when: you would have to guess the destination - no tool in this server reports a token's current position or the scene grid size, so ask the user for the target coordinates rather than inferring them. " +
      WRITE_GATE,
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
      'Apply or remove a status condition (e.g. "prone", "stunned") on a token\'s actor. Set active=false to remove. Matches by status id, so re-applying or clearing-when-absent is a no-op. Use when: a condition is gained or lost. Do not use when: changing numeric state such as HP or exhaustion - use update_actor_attributes. ' +
      WRITE_GATE +
      ' Exception: the no-op cases (applying an already-present status, or clearing an absent one) report success without attempting a write, so they also return normally while writes are disabled.',
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
    description:
      'Get the most recent chat messages from the game log. Use when: you need recent in-game context - what players said, or roll results that already happened.',
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
    description:
      "List the world's users with their roles and online status. Online status is as of the last world-data load, not a live presence check - no user-activity updates are applied afterwards, so call refresh_world_data first if it matters. Use when: you need to know which user holds the GM role, or who was connected as of that load.",
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
    description:
      'Search journal entries by name and page content. Use when: looking for notes, lore, or handouts by keyword. Do not use when: you already have the journalId - use get_journal.',
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
    description:
      'Get one journal entry by id with the text of its pages. Page bodies are HTML-stripped and each is truncated to its first 500 characters, marked with a trailing "...", so long pages come back partial. Use when: you have a journalId and need the text of its pages. Do not use when: you only have a title or keyword - run search_journals first.',
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
 * Journal mutation tool definitions (WRITE)
 */
export const journalMutationTools = [
  {
    name: 'create_journal_entry',
    description:
      'Create a new journal entry with one or more text pages, optionally filed under a folder. Defaults to GM-only visibility - pass visibility to let players read it. Use when: recording session notes, lore, or a handout in the world. Do not use when: adding text to an existing entry - this always creates a new one. ' +
      WRITE_GATE,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Title of the journal entry',
        },
        pages: {
          type: 'array',
          description: 'One or more pages to create on the entry',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Page title',
              },
              content: {
                type: 'string',
                description: 'Page body as HTML or plain text',
              },
            },
            required: ['name', 'content'],
          },
          minItems: 1,
        },
        folder: {
          type: 'string',
          description: 'Optional Folder document id to file the entry under',
        },
        visibility: {
          type: 'string',
          enum: ['gm-only', 'observer', 'owner'],
          description:
            "Who can see the entry. 'gm-only' (default) hides it from players; 'observer' lets every player read it; 'owner' lets every player read and edit it.",
        },
      },
      required: ['name', 'pages'],
    },
  },
];

/**
 * World-level tool definitions
 */
export const worldTools = [
  {
    name: 'search_world',
    description:
      'Search across all collections (actors, items, scenes, journals) by name, grouped by collection. Use when: you do not know which collection holds what you are looking for. Do not use when: you already know the collection - use search_actors, search_items, or search_journals. Of those, only search_journals prints document ids; for actor and item ids read the foundry://actors and foundry://items resources, each of which lists up to the first 100 documents (not exhaustive in larger worlds).',
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
    description:
      'Get world metadata (title, game system, core version) and per-collection document counts. Use when: orienting yourself in an unfamiliar world, or confirming the game system before system-specific edits.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'refresh_world_data',
    description:
      'Force a re-fetch of the cached world data from the FoundryVTT server. Reads are normally served from a cache that already follows live document changes, so this is rarely needed. Use when: a read still looks stale after an out-of-band change - notably edits to unlinked (synthetic) token actors, which the live update feed does not cover. Refreshes the cache only; it does not modify the world.',
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
    ...journalMutationTools,
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
