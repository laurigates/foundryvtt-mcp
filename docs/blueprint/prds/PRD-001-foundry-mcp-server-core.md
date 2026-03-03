---
id: PRD-001
title: FoundryVTT MCP Server Core
status: accepted
created: 2026-03-03
---

# PRD-001: FoundryVTT MCP Server Core

## Problem Statement

AI assistants like Claude have no native way to interact with FoundryVTT tabletop gaming sessions. Game masters and players cannot ask an AI assistant to query actors, roll dice, check combat state, or search world content without manually copying data out of FoundryVTT.

The Model Context Protocol (MCP) provides a standard interface for AI assistants to call external tools. A server implementing MCP against FoundryVTT's Socket.IO API enables natural-language interaction with live game sessions.

## Requirements

### Functional

1. **Authentication** - Authenticate with FoundryVTT via a 4-step Socket.IO flow (session cookie, user ID resolution, POST /join, reconnect) using `FOUNDRY_USERNAME` and `FOUNDRY_PASSWORD` credentials.

2. **World State Loading** - On successful connection, load and cache the complete world state snapshot (actors, items, scenes, journals, users, combat, messages) emitted by FoundryVTT.

3. **MCP Tools** - Expose the following tools to MCP clients:
   - `roll_dice` - Roll dice using standard RPG notation
   - `search_actors` / `get_actor_details` - Query characters and NPCs
   - `search_items` - Query equipment, spells, and consumables
   - `get_scene_info` - Retrieve current scene details
   - `search_journals` / `get_journal` - Search and retrieve journal entries
   - `get_users` - List online users and their status
   - `get_combat_state` - Current combat initiative order and state
   - `get_chat_messages` - Recent chat history
   - `search_world` - Full-text search across all world entities
   - `get_world_summary` - Overview of the current world state
   - `refresh_world_data` - Reload world data from FoundryVTT
   - `generate_npc` - Generate random NPC content
   - `generate_loot` - Generate treasure appropriate for a given level
   - `lookup_rule` - Retrieve game rules and spell descriptions

4. **MCP Resources** - Expose canonical resource URIs under the `foundry://` scheme for actors, items, scenes, journals, users, combat, and world settings.

5. **Configuration** - All connection parameters are environment-variable driven and validated at startup. Required: `FOUNDRY_URL`, `FOUNDRY_USERNAME`, `FOUNDRY_PASSWORD`. Optional: `FOUNDRY_USER_ID`, `LOG_LEVEL`, `FOUNDRY_TIMEOUT`, `FOUNDRY_RETRY_ATTEMPTS`, `FOUNDRY_RETRY_DELAY`, `CACHE_ENABLED`, `CACHE_TTL_SECONDS`, `CACHE_MAX_SIZE`.

6. **Error Handling** - Retry failed requests up to `FOUNDRY_RETRY_ATTEMPTS` times with `FOUNDRY_RETRY_DELAY` backoff. Surface actionable error messages for common failure modes (connection refused, auth failure, world not active).

### Non-Functional

- Node.js 18+ runtime; Bun as the package manager.
- TypeScript strict mode throughout.
- All tool queries served from the in-memory world state cache; no per-query Socket.IO round trips.
- Startup must complete authentication and world state load before accepting MCP requests.

## Out of Scope

- Write operations (combat management, token manipulation, journal editing, macro execution) are planned but not part of this PRD.
- Multi-world support is planned but not part of this PRD.
- The optional REST API diagnostics module is covered separately in PRD-002.
