# FoundryVTT MCP capability matrix (verified against source)

This document distinguishes **MCP tools that are exposed and implemented** from capabilities of Foundry VTT in general. It is based on this repository's `src/tools/definitions.ts`, `src/tools/availability.ts`, `src/foundry/capabilities.ts`, `src/tools/handlers/` and `src/foundry/client.ts`. The source revision exposes **33 tools (22 read/query/utility and 11 write tools)** and **9 MCP resources**.

**Evidence level:** implementation and routing inspected, and the per-mode tables below are pinned by tests (see [Keeping this page true](#keeping-this-page-true)). This is **not** a claim that all operations passed live end-to-end tests on every Foundry core version, world, system or combination of modules; dual mode has not yet run against a live Foundry and bridge. A method that exists internally but is not available via `tools/list` is not counted as an MCP tool.

## Connection modes

The mode is decided from configuration alone (`src/foundry/transport.ts`); an empty variable counts as unset. The design is recorded in [ADR-011](../adrs/0011-dual-mode-transport.md).

| Mode | Configuration | Consequences |
| --- | --- | --- |
| **Socket.IO** (`socket`, default) | `FOUNDRY_URL`, `FOUNDRY_USERNAME` or `FOUNDRY_USER_ID`, and `FOUNDRY_PASSWORD`. No `FOUNDRY_API_KEY`. | Authenticated connection to an active Foundry world. Loads world data and follows document changes. Needs no Foundry module. Prepared dnd5e values (non-flat AC, character max HP, save totals) are unavailable; compendium search, logs and system health are hidden. |
| **Dual** (`dual`) | Socket.IO credentials as above, plus `FOUNDRY_API_KEY` and `FOUNDRY_REST_URL` (the [REST bridge](./configuration.md#optional-rest-bridge-augment), e.g. `http://localhost:3030`). | Everything Socket.IO mode offers, plus Foundry's dice engine from the bridge, and prepared actor values, compendium search, logs and system health once the bridge defects below are fixed. A failed bridge call falls back to the Socket.IO answer or an "unavailable" label; no Socket.IO tool is hidden while the bridge is down. A bridge that answers 5xx (for example, no GM browser client) is skipped for that capability for 30 seconds, so only the first call waits for it. |
| **REST only** (`rest`, deprecated) | `FOUNDRY_API_KEY` without Socket.IO credentials, or with credentials but no `FOUNDRY_REST_URL` (then `FOUNDRY_URL` is treated as the bridge; this stays REST-only on purpose, with the warning, and is not promoted to dual mode). | Kept so older configurations behave as before; a warning is logged at startup. No writes, combat, journals, chat, users, world search or live updates. |

`FOUNDRY_REST_URL` without `FOUNDRY_API_KEY` stays in Socket.IO mode and logs that the augment is off. `FOUNDRY_WRITE_ENABLED=true` enables the write tools only where Socket.IO is connected.

The REST bridge is [laurigates/foundryvtt-local-rest-api](https://github.com/laurigates/foundryvtt-local-rest-api): a Foundry module plus a Node bridge server. It answers only while a GM is logged in through a browser with the module enabled. It is released (current release v2.1.2, Foundry v13 and v14); see the [configuration guide](./configuration.md#optional-rest-bridge-augment) for setup.

For **remote Foundry on Linux**, the local MCP client can access a reachable `FOUNDRY_URL` over Socket.IO without opening a Foundry browser tab on the client's computer. Foundry must have an active world and an authorized user; actual network and version compatibility should be tested.

## Tools by mode

What answers each tool when every configured source is healthy, copied from `TOOL_MATRIX` in `src/tools/__tests__/capability-matrix.test.ts`.

- `hidden`: left out of `tools/list` (even with `FOUNDRY_WRITE_ENABLED=true`), and a direct call is rejected with the reason.
- `socket` / `rest` / `local`: the source that answers (Socket.IO, the REST bridge, or computed in the MCP process).
- `+ rest (actor-derived)`: an augment answered by another source. `(no system-health)`: an augment the mode cannot serve.
- `[write opt-in]`: also needs `FOUNDRY_WRITE_ENABLED=true`.

Fallbacks after a failed bridge call are not shown.

| MCP tool | `socket` | `dual` | `rest` (deprecated) |
| --- | --- | --- | --- |
| `roll_dice` | local | rest | rest |
| `search_actors` | socket | socket + rest (actor-derived) | rest |
| `get_actor_details` | socket | socket + rest (actor-derived) | rest |
| `search_items` | socket | socket | rest |
| `get_scene_info` | socket | socket | rest |
| `generate_npc` | local | local | local |
| `generate_loot` | local | local | local |
| `lookup_rule` | local | local | local |
| `diagnose_errors` | local | local | local |
| `get_health_status` | socket (no system-health) | socket + rest (system-health) | rest |
| `get_combat_state` | socket | socket | hidden |
| `get_chat_messages` | socket | socket | hidden |
| `get_users` | socket | socket | hidden |
| `search_journals` | socket | socket | hidden |
| `get_journal` | socket | socket | hidden |
| `search_world` | socket | socket | hidden |
| `get_world_summary` | socket | socket | hidden |
| `refresh_world_data` | socket | socket | hidden |
| `search_compendium` | hidden | rest | rest |
| `get_recent_logs` | hidden | rest | rest |
| `search_logs` | hidden | rest | rest |
| `get_system_health` | hidden | rest | rest |
| `update_actor_attributes` | socket [write opt-in] | socket [write opt-in] | hidden |
| `create_actor_item` | socket [write opt-in] | socket [write opt-in] | hidden |
| `update_actor_item` | socket [write opt-in] | socket [write opt-in] | hidden |
| `delete_actor_item` | socket [write opt-in] | socket [write opt-in] | hidden |
| `create_journal_entry` | socket [write opt-in] | socket [write opt-in] | hidden |
| `start_combat` | socket [write opt-in] | socket [write opt-in] | hidden |
| `next_turn` | socket [write opt-in] | socket [write opt-in] | hidden |
| `end_combat` | socket [write opt-in] | socket [write opt-in] | hidden |
| `set_initiative` | socket [write opt-in] | socket [write opt-in] | hidden |
| `move_token` | socket [write opt-in] | socket [write opt-in] | hidden |
| `apply_status_effect` | socket [write opt-in] | socket [write opt-in] | hidden |

**Bridge route fixes released, live check pending.** Two bridge defects affected these tools: diagnostics routing and the missing compendium route ([laurigates/foundryvtt-local-rest-api#6](https://github.com/laurigates/foundryvtt-local-rest-api/issues/6); `search_compendium`, `get_recent_logs`, `search_logs`, `get_system_health` and the system-health part of `get_health_status`), and actor reads that failed validation and ignored search filters ([laurigates/foundryvtt-local-rest-api#8](https://github.com/laurigates/foundryvtt-local-rest-api/issues/8); the prepared values in `get_actor_details` and `search_actors`). Both were fixed in its [PR #4](https://github.com/laurigates/foundryvtt-local-rest-api/pull/4) and shipped in v2.1.0. The dual-mode cells above have not yet been verified against a live Foundry and bridge.

## Read, search, utility and diagnostic tools (22)

| MCP tool | Implemented behavior | Important limits |
| --- | --- | --- |
| `search_actors` | Find world actors by name/type; summarize level and HP. In dual mode, max HP comes from the bridge. | Text output does **not** include actor IDs. |
| `get_actor_details` | Read HP, AC, abilities and level for a known actor ID. In dual mode it adds prepared AC, max HP and a **Saving Throws** line from the bridge. | Not a complete biography or owned-inventory listing. In Socket.IO mode, non-flat AC, character max HP and save totals print as unavailable ([ADR-012](../adrs/0012-derived-values-from-source-data.md)). |
| `search_items` | Find world-level items by name/type. | Not actor-owned items or packs; the rarity filter applies only in the deprecated REST-only mode. |
| `search_compendium` | Search enabled compendium packs with filters and cursors. | **Needs the REST bridge** (dual or REST-only mode); hidden in Socket.IO mode. Read-only. Blocked on the bridge's missing compendium route (see above). |
| `get_scene_info` | Read current or specified scene's metadata. | Does not report walls, token coordinates or grid details; does not switch/edit scenes. |
| `search_journals` | Match journal **names**, page **names** and page **text** (case-insensitive substring); returns matching entries and their IDs. | Substring matching only (no ranking, no HTML stripping of the matched text); use `get_journal` for page excerpts. |
| `get_journal` | Return text excerpts of a journal's pages. | HTML stripped; up to 500 characters per page. |
| `get_users` | Read users and online presence from world data. | Relies on available world state. |
| `get_combat_state` | Read active encounter and initiative order. | Reads cached Socket.IO world state. |
| `get_chat_messages` | Read recent game chat. | No MCP tool for posting messages. |
| `search_world` | Case-insensitive **name** matching for actors, items, scenes, journals. | Despite earlier descriptions, **not full-text search of document bodies**. |
| `get_world_summary` | World metadata and collection counts. | Snapshot-dependent counts use cached Socket.IO data. |
| `refresh_world_data` | Re-fetch full world snapshot. | Requires active Socket.IO; does not alter the world. |
| `roll_dice` | Roll dice, returning a total and breakdown. | Portable grammar: dice terms/integers joined with + or -. Advanced modifiers are rejected. With the bridge (dual or REST-only), Foundry's Roll engine evaluates the formula, including parentheses; the local roller (Socket.IO mode, or the dual-mode fallback) rejects them. |
| `generate_npc` | Generate a random NPC description and basic stats. | **Text only**; does not create a Foundry Actor. |
| `generate_loot` | Generate simple coin amounts and item suggestions. | **Text only**; item list is fixed and `treasureType` does not affect the result. |
| `lookup_rule` | Format a rule-search-like answer. | **Stub** returning template text; no real rules source is consulted. |
| `get_recent_logs` | Read and filter recent Foundry logs. | Needs the REST bridge. |
| `search_logs` | Search logs and show matching entries. | Needs the REST bridge. |
| `get_system_health` | Fetch backend health/version/module and memory information. | Needs the REST bridge; not full CPU/disk monitoring. |
| `diagnose_errors` | Format a diagnosis summary. | **Stub**: fixed response, not an actual investigation. |
| `get_health_status` | Summarize the transport mode, the Socket.IO state, the bridge state (reachable, unreachable, answering with errors, rejected or unusable response, with the last error and running pauses), the world, and the bridge's system health. | System health needs the bridge; can warn about a stale world snapshot. |

## Mutating tools (11)

The following tools **are implemented and routed**. Every write is gated by `FOUNDRY_WRITE_ENABLED=true` (default false), an **active authenticated Socket.IO session** (Socket.IO or dual mode), and Foundry's GM/owner permissions. Start testing with writes disabled.

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

All nine resources are listed in every mode. The source columns are copied from `RESOURCE_MATRIX` in `src/tools/__tests__/capability-matrix.test.ts`, which observes them by reading each resource through a `FoundryClient` with Socket.IO and the bridge mocked. `socket` means the answer comes from the world snapshot, `rest GET <route>` that the bridge was asked for that route, and `none` that neither answered: the resource returns an empty list or an unavailable message.

| Resource URI | Contents | `socket` | `dual` | `rest` (deprecated) |
| --- | --- | --- | --- | --- |
| `foundry://actors` | First 100 actor summaries, IDs and total count. | socket | socket + rest GET /api/actors | rest GET /api/actors |
| `foundry://items` | First 100 world item summaries, IDs and total count. | socket | socket | rest GET /api/items |
| `foundry://scenes` | Scene IDs, names, active state. | socket | socket | none |
| `foundry://scenes/current` | Current scene details or no-active-scene message. | socket | socket | rest GET /api/scenes/current |
| `foundry://journals` | Journal IDs, names and page counts. | socket | socket | none |
| `foundry://users` | Users and activity. | socket | socket | none |
| `foundry://combat` | Active combat with combatants sorted by initiative. | socket | socket | none |
| `foundry://world/settings` | World/system metadata. | socket | socket | rest GET /api/world |
| `foundry://system/diagnostics` | Bridge diagnostics or unavailable notice. | none | rest GET /api/diagnostics/health | rest GET /api/diagnostics/health |

REST-only mode lists the scenes, journals, users and combat resources and then returns empty data (#333). The bridge routes `/api/scenes/current` correctly (a60decf on the module's `feat/v14-port`; on its `main` since its PR #3), so `foundry://scenes/current` in REST-only mode is not affected by laurigates/foundryvtt-local-rest-api#6, whose scenes item is stale.

## Fields one transport reports and the other does not

For the same dnd5e documents, after the MCP's own mappers, the two transports differ in these fields. The reviewed list is `KNOWN_GAPS` in `src/foundry/parity.ts`; dual mode overlays every REST-only actor field onto the Socket.IO actor.

| Document | Only from the REST bridge | Only from Socket.IO |
| --- | --- | --- |
| Actor | `hp.max`, `ac.value`, `abilities.*.save` (prepared values, computed only in a browser client) | `hp.temp`, `attributes.prof` (the bridge route does not send them) |
| Item | `price.value`, `price.denomination`, `weight`, `quantity`, `equipped`, `identified` (the Socket.IO mapper does not read them); `rarity` (the bridge sends `common` for an empty value) | `description` (the bridge's search route does not send it) |
| World | `modules.*.id`, `modules.*.title`, `modules.*.active` (the Socket.IO mapper does not map the module list) | — |

## Not exposed through this MCP interface

This section means **no registered MCP tool currently offers the operation**. It does **not** claim Foundry VTT or a future REST adapter cannot perform it.

- Create/delete world Actors or broadly edit the Actor document outside the exposed `actor.system` patch.
- Create, delete or edit world scenes; switch the active scene; manage walls, doors, lights, tiles, drawings, regions, and sound emitters.
- Create/delete scene tokens or perform collision-aware token movement.
- Edit/delete existing journals; manage playlists, roll tables, decks, macro execution, or file operations through dedicated MCP tools.
- Ask a specific player for a roll; send a new chat message.
- Write to compendiums or import a compendium entry directly into an actor.

## Example: local MCP client -> remote Linux Foundry (read only)

The canonical Socket.IO client configuration lives in the [integration guide](./integration.md#connect-via-socketio-default). Use an account with the minimum permissions required, put real credentials in private client configuration (not in the repository), and set `FOUNDRY_WRITE_ENABLED=true` only after validating read behavior and backups.

## Keeping this page true

Three tests fail when the difference between the modes changes, and each failure names the files to update together: the matrix, `KNOWN_GAPS`, this page, and [ADR-011](../adrs/0011-dual-mode-transport.md) when a gap opens or closes.

- `src/tools/__tests__/capability-matrix.test.ts`: the tool and resource tables above.
- `src/foundry/__tests__/parity-contract.test.ts`: the field table above, on one dnd5e scenario.
- `tests/integration/parity.integration.test.ts`: the same comparison against a live Foundry and bridge; it skips without credentials and has not yet run live.

## Source references

- Tool names, input schemas and descriptions: [`src/tools/definitions.ts`](../../src/tools/definitions.ts)
- Mode selection: [`src/foundry/transport.ts`](../../src/foundry/transport.ts)
- Per-capability sources and the tool-to-capability map: [`src/foundry/capabilities.ts`](../../src/foundry/capabilities.ts)
- Tool availability gate: [`src/tools/availability.ts`](../../src/tools/availability.ts)
- Handler dispatch: [`src/tools/router.ts`](../../src/tools/router.ts)
- Implemented tool handlers: [`src/tools/handlers/`](../../src/tools/handlers)
- Reads, fallback, write gating and socket mutations: [`src/foundry/client.ts`](../../src/foundry/client.ts)
- Bridge response mapping: [`src/foundry/rest-mappers.ts`](../../src/foundry/rest-mappers.ts)
- Resource names: [`src/tools/resources.ts`](../../src/tools/resources.ts)
- Resource payloads and truncation: [`src/tools/handlers/resources.ts`](../../src/tools/handlers/resources.ts)
- Environment variables: [`src/config/index.ts`](../../src/config/index.ts)
