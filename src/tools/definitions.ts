/**
 * @fileoverview Tool definitions for FoundryVTT MCP Server
 *
 * This module contains all tool schema definitions organized by category.
 * Tools are separated into logical groups for better maintainability.
 */

/**
 * Shared write-safety clause appended to every mutation tool description.
 *
 * ToolCatalog checks the selected target's writeEnabled setting and core.write
 * capability; providers also enforce their connection and dispatch guards.
 * Foundry itself enforces the GM/owner permission (ADR-010 and ADR-011).
 */
const WRITE_GATE =
  'WRITE: mutates the selected target world. Requires that target\'s writeEnabled=true (default false), core.write capability and a connected provider; Foundry additionally enforces GM/owner permission on the document. In environment-only single-target configuration, the opt-in is FOUNDRY_WRITE_ENABLED=true. Socketio/composite use native document writes; rest-api uses the paired runtime; legacy-rest does not provide core writes. An interrupted write can return outcome_unknown: inspect the world before retrying.';

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
  'Roll dice and return the total with a per-term breakdown. Portable syntax uses dice terms and whole numbers joined by + or -, with optional whitespace ("1d20+5", "2d6 + 1d4", "3d6"; "d20" means one die). Multiplication and Foundry modifiers such as "4d6kh3" or "1d20r1" are rejected. Socketio and composite core rolls use the local roller, which rejects parentheses. The rest-api provider evaluates in the paired Foundry runtime and allows parentheses, without a local fallback. The historical legacy-rest provider (FOUNDRY_API_KEY in environment configuration) first asks the bridge to roll remotely, then falls back to the local roller if that fails; parentheses can therefore fail on its fallback. The result\'s Source line identifies "FoundryVTT server" or the local roller. Use when: the user asks for a check, save, attack, damage, or any random result.';

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
      "Search actors (player characters, NPCs) by name, optionally filtered by type. Returns a summary line per match: name, type, level and current/max HP. Use when: checking whether an actor exists, or getting a quick roster with HP. For one actor's ability scores, use get_actor_details. This tool does not print actorId: read foundry://targets/<target_id>/actors for up to the first 100 actors with their _id (not exhaustive in larger worlds). The foundry://actors alias is available only with one configured target.",
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
      'Get details for one actor by id: type, level, current/max HP, AC and ability scores; no biography or description text is returned (the description line always reads "No description available."). Fields depend on the selected system projection. Use when: you have an actorId and need its current HP or ability scores, including before update_actor_attributes. With only a name, run search_actors and read the target actor resource for IDs. Owned-item IDs are not returned here; module_item-piles_get_items can supply them when that integration is available, otherwise obtain the exact itemId from the user.',
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
 * WRITE operations require the selected target's write opt-in and core.write.
 */
export const actorMutationTools = [
  {
    name: 'update_actor_attributes',
    description:
      'Update fields on an actor\'s system data. Patch keys are dot-paths into actor.system and values are absolute target values, never relative deltas. Paths and bounds depend on the selected system projection. D&D 5e examples include "attributes.hp.value", "attributes.hp.temp", "currency.gp", "resources.primary.value", "spells.spell1.value" and "attributes.exhaustion"; its validation checks HP <= max + temp, spell slots <= max, and exhaustion within 0-10 (2024) or 0-6 (2014). Returns the post-update value for every patched path. Use when: applying damage or healing, spending a resource, or adjusting currency on a known actorId. For owned-item changes use update_actor_item; for current values use get_actor_details. ' +
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
      'Search item documents in the world by name, optionally filtered by type. Returns name, type and rarity per match (rarity shows "Common" when the system records none); price always prints "Unknown price". The rarity filter is passed to the historical legacy-rest bridge and is ignored by socketio, rest-api and composite snapshot searches. Item IDs are not printed: read foundry://targets/<target_id>/items for up to the first 100 items with their _id (not exhaustive in larger worlds). The foundry://items alias is available only with one configured target. Use when: checking whether an item exists in the world. For compendium packs use search_compendium; for an actor inventory use an available integration such as module_item-piles_get_items.',
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
            'Item rarity filter (common, uncommon, rare, etc.). Passed only to the historical legacy-rest bridge; ignored by the other providers.',
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
      'Search FoundryVTT compendium packs by name and metadata; searches all enabled packs unless compendiumId scopes it to one pack. Use when: looking up spells, monsters, or equipment that are not yet present in the world. For world documents use search_items or search_world. Requires compendium.read on the selected target, currently supplied only by the historical legacy-rest bridge. The catalog withholds this tool when no ready target has that capability and rejects calls on an unsupported target.',
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
 * Actor item mutation tool definitions (WRITE — target write opt-in and core.write)
 *
 * The canonical mutation target is the D&D 5e v4+ activity schema. Item
 * `system` patches honour JSON-merge-patch semantics on nested paths.
 */
export const itemMutationTools = [
  {
    name: 'create_actor_item',
    description:
      'Create an item on an actor from an inline item document (type, name, system). Use when: adding a new weapon, spell, feature, or piece of equipment to a known actorId. For an existing owned item use update_actor_item. Replacing an item is not atomic: create the replacement first and delete the old one second, so a mid-sequence failure leaves the actor with a duplicate rather than nothing. Compendium-source create is not implemented by the current core providers. Supply item data appropriate to the selected game system; D&D 5e activity examples target v4+. ' +
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
            'Item source. Use { type: "inline", item: { type, name, system } } to create the item directly. The { type: "compendium", compendiumId, itemId } shape is accepted by the schema but rejected at call time by the current core providers.',
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
      "Permanently remove an item owned by an actor. Use when: the user explicitly asks to delete or discard a specific owned item and you have its exact actorId and itemId. An available module_item-piles_get_items integration can return owned-item IDs; otherwise obtain them from the user. Never guess an ID. For data changes use update_actor_item. In a replacement or migration flow, run create_actor_item first and this second: the calls are not atomic, and failing after the delete loses the item. Confirm the actorId, itemId and selected target with the user before calling. " +
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
      'Get recent FoundryVTT server log entries, optionally filtered by level or since a timestamp. Use when: investigating an error or recent server behaviour. For a specific term use search_logs. Requires diagnostics.read on the selected target, currently supplied only by the historical legacy-rest bridge. The paired rest-api relay does not provide this diagnostics endpoint.',
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
      'Search the FoundryVTT server logs for a query string and list matching entries. Use when: hunting a specific error message, stack trace, or module name. For the latest entries use get_recent_logs. The reported match count is the server\'s total for the query, while limit caps rendered entries (default 50, hard cap 1000). Level filtering accepts info, warn and error; unsupported "debug" is reported and no level filter is applied. Requires diagnostics.read on the selected target, currently supplied only by the historical legacy-rest bridge; the paired rest-api relay does not provide this endpoint.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for log contents',
        },
        level: {
          type: 'string',
          description:
            'Log level filter; "debug" is not recorded by this log store and is not applied',
          enum: ['debug', 'info', 'warn', 'error'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of matched entries to render (capped at 1000)',
          default: 50,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_system_health',
    description:
      "Get the historical bridge's server health report: overall status, FoundryVTT and system versions, world id, uptime, user/module/client counts, heap/RSS memory and recent log statistics. CPU and disk are not reported; uptime and memory are omitted when absent from the response. Requires diagnostics.read on the selected target, currently supplied only by legacy-rest. The paired rest-api relay does not provide this endpoint. For connection and world status use get_health_status.",
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
      "Get the selected target's provider connection state, world title/system/core version and any available legacy diagnostics. Socketio follows the native link; composite requires both its native and relay connections; HTTP provider status reflects observed requests rather than a continuous remote probe. Socketio/composite caches follow supported native updates, while rest-api snapshots need refresh_world_data for changes made elsewhere. Known stale caches are refreshed before ordinary core calls; explicit refresh also rebuilds the session integration context. Diagnostics sections report unavailable when the provider lacks the historical bridge API. Uptime and memory are omitted when absent; CPU, disk and playtime are not reported. Use when: checking the loaded world and available health information; get_target_status adds session and integration failure details.",
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
      "Get the active combat encounter: initiative order with each combatant's name, initiative, HP and AC, plus the current round and combatant. Use when: reporting whose turn it is, or checking for an existing combat before start_combat. This prints names and ordinals; for combatantId read foundry://targets/<target_id>/combat. Its combatants include _id in the same initiative order, and combat.turn indexes that array. The foundry://combat alias is available only with one configured target.",
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Combat control mutation tool definitions (FR-018)
 *
 * WRITE operations require the selected target's write opt-in and core.write.
 * All operate on the active combat; the remote user needs GM/owner permission.
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
      "Set a combatant's initiative in the active combat (or in combatId when given), reordering the turn order. When that reorder moves the combatant who is currently acting to a different position, the encounter's turn index is rewritten to follow them - whoever was up stays up, and the result says so - rather than leaving the marker on whoever slid into the old slot. That follow-up applies only to the active combat: a combatId naming some other encounter still records the initiative, but its turn order is not readable here and is left alone. Use when: an initiative roll needs to be recorded or corrected for a known combatantId. Do not use when: simply moving on to the next combatant - use next_turn. " +
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
 * WRITE operations require the selected target's write opt-in and core.write.
 * The remote user needs GM/owner permission.
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
      "List the selected world's users with their roles and observed online status. Socketio and composite apply native userActivity broadcasts to their presence cache; missed broadcasts after disconnection require resynchronization. Standalone rest-api reports presence from its last snapshot, so use refresh_world_data for changes made elsewhere. Known stale caches are refreshed before core reads. Use when: checking roles or the latest available presence information.",
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
      'Search the selected world snapshot across actor, item, scene and journal names and available descriptive text: biographies, item descriptions, scene annotations/token names and journal page text. Results are grouped by collection; content matches include a plain-text excerpt and field path. Phrase matching ignores case and accents. A blank query, including markup-only text, returns no documents. Requires core.cache, supplied by socketio, rest-api and composite; does not search compendiums, attached files or arbitrary system fields. For document IDs read foundry://targets/<target_id>/actors, foundry://targets/<target_id>/items or foundry://targets/<target_id>/journals; actor/item resources are capped at 100 results. Unqualified foundry:// aliases are available only with one configured target. Use when: locating a name or narrative phrase across collections; for a known collection use search_actors, search_items or search_journals.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search phrase to match against names and available descriptive content',
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
      'Re-fetch the selected target\'s world snapshot and rebuild its session/integration context. Explicit refresh invalidates pending work from the previous session generation. Socketio/composite follow supported native broadcasts; rest-api needs explicit refresh for changes made elsewhere in Foundry. Use after changes not represented by the cache, including synthetic token actors, or to recheck runtime/integration availability. Routine refresh of a known stale cache already occurs before core calls without replacing the session. This operation does not mutate the remote world.',
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
