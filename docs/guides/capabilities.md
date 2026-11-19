# FoundryVTT MCP capability matrix (verified against source)

This document distinguishes **MCP tools that are exposed and implemented** from capabilities of Foundry VTT in general. It is based on this repository's `src/index.ts`, `src/tools/definitions.ts`, `src/tools/router.ts`, `src/tools/handlers/` and `src/foundry/client.ts`. The source revision exposes **33 tools (22 read/query/utility and 11 write tools)** and **9 MCP resources**.

**Evidence level:** implementation and routing inspected; this is **not** a claim that all operations passed live end-to-end tests on every Foundry core version, world, system or combination of modules. A method that exists internally but is not available via `tools/list` is not counted as an MCP tool.

## Connection modes: not interchangeable

| Mode | Configuration | Consequences |
| --- | --- | --- |
| **Socket.IO** (default) | `FOUNDRY_URL`, `FOUNDRY_USERNAME` or `FOUNDRY_USER_ID`, and `FOUNDRY_PASSWORD`. **Leave `FOUNDRY_API_KEY` unset.** | Authenticated connection to an active Foundry world. Loads world data and observes document changes. The 11 mutation tools require this mode, the write opt-in and Foundry permissions. |
| **Foundry Local REST API** (optional) | Set `FOUNDRY_API_KEY` | Changes `FoundryClient.connect()` to REST-mode initialization using `/api/world`. Enables REST-only operations such as `search_compendium` and supporting diagnostics. **It does not create the Socket.IO session needed for mutation tools.** Several world-snapshot-dependent tools have reduced or unavailable behavior in this mode. |

**Important:** `FOUNDRY_API_KEY` is a **transport selector**, not a way to add REST features to an existing Socket.IO session. `FOUNDRY_WRITE_ENABLED=true` does not enable mutations in REST mode.

The local REST API module referred to by the current `/api/...` routes is **not** [ThreeHats/foundryvtt-rest-api-relay](https://github.com/ThreeHats/foundryvtt-rest-api-relay). No ThreeHats REST Relay tools are integrated with this MCP server yet.

For **remote Foundry on Linux**, the local MCP client can access a reachable `FOUNDRY_URL` over Socket.IO without opening a Foundry browser tab on the client's computer. Foundry must have an active world and an authorized user; actual network and version compatibility should be tested.

## Read, search, utility and diagnostic tools (22)

| MCP tool | Implemented behavior | Important limits |
| --- | --- | --- |
| `search_actors` | Find world actors by name/type; summarize level and HP. | Text output does **not** include actor IDs. |
| `get_actor_details` | Read HP, AC, abilities and level for a known actor ID. | Not a complete biography or owned-inventory listing. |
| `search_items` | Find world-level items by name/type. | Not actor-owned items or packs; rarity filtering is REST-mode-only. |
| `search_compendium` | Search enabled compendium packs with filters and cursors. | **Requires `FOUNDRY_API_KEY` (REST mode)**; otherwise reports no results with a note. Read-only. |
| `get_scene_info` | Read current or specified scene's metadata. | Does not report walls, token coordinates or grid details; does not switch/edit scenes. |
| `search_journals` | Find journal entries and their IDs. | Not full-text search of every journal page. |
| `get_journal` | Return text excerpts of a journal's pages. | HTML stripped; up to 500 characters per page. |
| `get_users` | Read users and online presence from world data. | Relies on available world state. |
| `get_combat_state` | Read active encounter and initiative order. | Reads cached Socket.IO world state. |
| `get_chat_messages` | Read recent game chat. | No MCP tool for posting messages. |
| `search_world` | Case-insensitive **name** matching for actors, items, scenes, journals. | Despite earlier descriptions, **not full-text search of document bodies**. |
| `get_world_summary` | World metadata and collection counts. | Snapshot-dependent counts use cached Socket.IO data. |
| `refresh_world_data` | Re-fetch full world snapshot. | Requires active Socket.IO; does not alter the world. |
| `roll_dice` | Roll dice, returning a total and breakdown. | Portable grammar: dice terms/integers joined with + or -. Advanced modifiers are rejected. REST mode supports some broader syntax (e.g., parentheses); local fallback does not. |
| `generate_npc` | Generate a random NPC description and basic stats. | **Text only**; does not create a Foundry Actor. |
| `generate_loot` | Generate simple coin amounts and item suggestions. | **Text only**; item list is fixed and `treasureType` does not affect the result. |
| `lookup_rule` | Format a rule-search-like answer. | **Stub** returning template text; no real rules source is consulted. |
| `get_recent_logs` | Read and filter recent Foundry logs. | REST diagnostics backend required. |
| `search_logs` | Search logs and show matching entries. | REST diagnostics backend required. |
| `get_system_health` | Fetch backend health/version/module and memory information. | REST diagnostics backend required; not full CPU/disk monitoring. |
| `diagnose_errors` | Format a diagnosis summary. | **Stub**: fixed response, not an actual investigation. |
| `get_health_status` | Summarize connection/world and available backend status. | Partial information without REST diagnostics; can warn about a stale world snapshot. |

## Mutating tools (11)

The following tools **are implemented and routed**. Every write is gated by `FOUNDRY_WRITE_ENABLED=true` (default false), an **active authenticated Socket.IO session**, and Foundry's GM/owner permissions. Start testing with writes disabled.

| MCP tool | Implemented behavior | Boundaries and safety |
| --- | --- | --- |
| `update_actor_attributes` | Set absolute dot-path values under `actor.system` (HP, currency, slots, etc.). | Not a general-purpose Actor editor or relative damage/healing operation; some game-stat bounds are validated. |
| `create_actor_item` | Create an inline Item embedded in an existing Actor. | `source.type=compendium` is **rejected at runtime** despite appearing in the input schema. |
| `update_actor_item` | JSON-merge-patch the `system` data of an owned item. | Needs actor ID and embedded item ID; arrays replace, `null` removes fields. |
| `delete_actor_item` | Delete an item owned by an Actor. | **Destructive; no built-in undo.** Confirm exact IDs before use. |
| `create_journal_entry` | Create a JournalEntry with one or more text pages. | Optional folder and visibility; defaults to GM-only. No corresponding existing-journal edit/delete tool. |
| `start_combat` | Create Combat and add combatants from chosen/current scene tokens. | Does **not** check for an existing encounter, so can create a second combat. |
| `next_turn` | Move to next combat turn/round. | Can optionally skip defeated combatants. |
| `end_combat` | End by deleting the active Combat document. | **Destructive**, not a pause action. |
| `set_initiative` | Change a combatant's initiative. | Preserves current acting combatant's place when possible; requires combatant ID. |
| `move_token` | Move a placed token to new x/y scene coordinates. | Does not provide pathfinding/collision planning or create tokens. |
| `apply_status_effect` | Apply/remove an ActiveEffect status via a token's actor. | Handles linked and synthetic (unlinked) actors; requires a valid status ID. |

**IDs and read-before-write:** `search_actors`/`search_items` return text summaries **without IDs**. The `foundry://actors` and `foundry://items` resources expose IDs but cap each list at **100 entries**. `foundry://combat` includes combatant IDs in initiative order. No dedicated tool lists an actor's embedded item IDs. Do not guess IDs for destructive operations.

## MCP resources (9)

| Resource URI | Contents |
| --- | --- |
| `foundry://actors` | First 100 actor summaries, IDs and total count. |
| `foundry://items` | First 100 world item summaries, IDs and total count. |
| `foundry://scenes` | Scene IDs, names, active state. |
| `foundry://scenes/current` | Current scene details or no-active-scene message. |
| `foundry://journals` | Journal IDs, names and page counts. |
| `foundry://users` | Users and activity. |
| `foundry://combat` | Active combat with combatants sorted by initiative. |
| `foundry://world/settings` | World/system metadata. |
| `foundry://system/diagnostics` | REST-backed diagnostics or unavailable notice. |

## Not exposed through this MCP interface

This section means **no registered MCP tool currently offers the operation**. It does **not** claim Foundry VTT or a future REST adapter cannot perform it.

- Create/delete world Actors or broadly edit the Actor document outside the exposed `actor.system` patch.
- Create, delete or edit world scenes; switch the active scene; manage walls, doors, lights, tiles, drawings, regions, and sound emitters.
- Create/delete scene tokens or perform collision-aware token movement.
- Edit/delete existing journals; manage playlists, roll tables, decks, macro execution, or file operations through dedicated MCP tools.
- Ask a specific player for a roll; send a new chat message.
- Write to compendiums or import a compendium entry directly into an actor.
- Call ThreeHats REST API Relay endpoints.

## Example: local MCP client -> remote Linux Foundry (read only)

```json
{
  "mcpServers": {
    "foundryvtt": {
      "command": "npx",
      "args": ["-y", "foundryvtt-mcp"],
      "env": {
        "FOUNDRY_URL": "https://foundry.example.com",
        "FOUNDRY_USERNAME": "mcp-api",
        "FOUNDRY_PASSWORD": "REPLACE_WITH_SECRET",
        "FOUNDRY_WRITE_ENABLED": "false"
      }
    }
  }
}
```

Use an account with the minimum permissions required; put real credentials in private client configuration, not in the repository. Set `FOUNDRY_WRITE_ENABLED=true` only after validating read behavior and backups. This example uses Socket.IO and intentionally **omits** `FOUNDRY_API_KEY`.

## Source references

- Tool names, input schemas and descriptions: [`src/tools/definitions.ts`](../../src/tools/definitions.ts)
- Exposed list and connection lifecycle: [`src/index.ts`](../../src/index.ts)
- Handler dispatch: [`src/tools/router.ts`](../../src/tools/router.ts)
- Implemented tool handlers: [`src/tools/handlers/`](../../src/tools/handlers)
- Transport selection, reads, write gating, and socket mutations: [`src/foundry/client.ts`](../../src/foundry/client.ts)
- Resource names: [`src/tools/resources.ts`](../../src/tools/resources.ts)
- Resource payloads and truncation: [`src/tools/handlers/resources.ts`](../../src/tools/handlers/resources.ts)
- Environment variables: [`src/config/index.ts`](../../src/config/index.ts)
