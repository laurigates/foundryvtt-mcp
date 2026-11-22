# FoundryVTT MCP capability matrix

This page describes the **target-scoped overhaul** on `feat/multiworld-provider-overhaul`. It summarizes source contracts, not verified live compatibility with every Foundry version, game system or module. For the implementation details see `src/tools/catalog.ts`, `src/tools/definitions.ts`, `src/providers/`, `src/tools/resources.ts` and [ADR-011](../adrs/0011-provider-session-integration-overhaul.md).

## Discovery and target routing

The static catalog defines **33 core tools** (22 read/query/utility tools and 11 mutating tools). The new server additionally defines **5 management tools** (`list_targets`, `get_target_status`, `list_systems`, `list_modules`, `reconnect_target`). Trusted integrations may contribute further, dynamically available tools; there is **no fixed total tool count** across target configurations.

`src/index.ts` uses `ToolCatalog` for both `tools/list` and `tools/call`. The catalog:
- resolves `target_id` to a session (optional only when exactly one target is configured);
- lists a core tool if **at least one ready target** supports the required capability;
- checks availability **again on the selected target** before execution, including connection state, write opt-in and any system restriction;
- exposes integration operations only when their manifests, runtime probes and schemas are compatible; conflicting public schemas are withheld;
- emits catalog change notifications on session/integration state changes.

`src/tools/availability.ts` retains the older two-transport availability helpers for compatibility and corresponding tests. It is **not** the target-aware MCP dispatch gate. A tool visible in the global catalog may be unavailable on an individual target.

## Providers are not interchangeable

| Provider | How it connects | Relevant operations |
|---|---|---|
| `socketio` | Authenticated native Foundry session with live world-data cache | Core read/cache operations; core writes via Socket.IO `modifyDocument` if enabled |
| `legacy-rest` | Historical `/api/*` bridge selected by `FOUNDRY_API_KEY` in legacy configuration | Shared core reads, compendium search and legacy REST diagnostics; no native Socket.IO world-cache capability |
| `rest-api` | Paired ThreeHats relay, runtime bindings and refreshed world snapshot | Core read/cache and optional target-enabled document writes through Foundry runtime APIs; runtime integration bindings |
| `composite` | Native Socket.IO core plus a separately authenticated paired relay | Socket.IO core operations and relay integration execution for one identity-verified world |

`FOUNDRY_API_KEY` is **not** a relay credential; `FOUNDRY_REST_API_KEY` supplies the legacy-environment relay key. Explicit targets select the provider using `provider.kind`. A composite verifies consistent world/origin/system identity; neither composite nor standalone relay silently falls back to another transport after an uncertain write. See [configuration](configuration.md) and [providers/targets](providers-and-targets.md).

Capabilities used for the core include `core.read`, `core.cache`, `core.write`, `compendium.read` and `diagnostics.read`. `runtime.execute` is required for executable system/module integrations; operations may additionally depend on a specific active system or module. A write needs a target-local opt-in **and** suitable provider/runtime/Foundry permissions.

A `composite` is ready only when both connections are available. Its core tools
are also withheld if the relay fails; no degraded native-only mode is provided.
Configure an independent `socketio` target for separately available native access.

## Core read, query and utility tools (22)

| Tool | What is implemented | Availability/limits |
|---|---|---|
| `roll_dice` | Dice total and breakdown | Grammar/remote evaluation depends on provider |
| `search_actors` | Search world actors by name/type | Returns summaries, not a full list of embedded items |
| `get_actor_details` | Basic actor information | Requires an actual actor ID |
| `search_items` | World item search | Not a search of every actor's inventory |
| `get_scene_info` | Current/selected scene metadata | Read-only; does not activate a scene |
| `generate_npc` | Demonstration NPC text | Offered for D&D 5e targets only; creates no Actor |
| `generate_loot` | Demonstration loot text | Offered for D&D 5e targets only; creates no items |
| `lookup_rule` | Placeholder response | D&D 5e target only; **no real rules database** |
| `diagnose_errors` | Placeholder diagnosis | Not a real error investigator |
| `get_health_status` | Connection and cache health summary | Partial without legacy diagnostics |
| `get_combat_state` | Current combat snapshot | Needs `core.cache` |
| `get_chat_messages` | Recent world chat | Needs `core.cache`; no posting tool |
| `get_users` | Users/online presence | Needs `core.cache` |
| `search_journals` | Journal name and page search | Needs `core.cache` |
| `get_journal` | Journal page excerpts | Needs `core.cache` |
| `search_world` | Search actors, items, scenes and journals by names **and selected narrative fields** | Needs `core.cache`; plain-text match excerpts, no semantic ranking or compendium-wide search |
| `get_world_summary` | World metadata and collection counts | Needs `core.cache` |
| `refresh_world_data` | Explicit resynchronization of the selected world | Needs `core.cache`; may invalidate session/integration state |
| `search_compendium` | Pack search with filters | Requires `compendium.read` (historical bridge capability) |
| `get_recent_logs` | Historical REST backend logs | Requires `diagnostics.read` |
| `search_logs` | Historical REST backend log search | Requires `diagnostics.read` |
| `get_system_health` | Historical REST backend health metrics | Requires `diagnostics.read` |

`search_world` uses `src/foundry/world-search.ts` and returns the matching field/excerpt for content hits. It searches selected actor descriptions/biographies, item descriptions, scene annotations/tokens and journal page content, with HTML converted to plain text. It does not index arbitrary module fields or use an external search engine.

## Core mutating tools (11)

| Tool | Action |
|---|---|
| `update_actor_attributes` | Patch supported actor system attributes |
| `create_actor_item` | Create an embedded item on an actor |
| `update_actor_item` | Update an actor's embedded item |
| `delete_actor_item` | Delete an embedded item |
| `create_journal_entry` | Create a journal with text pages |
| `start_combat` | Create an encounter from selected scene tokens |
| `next_turn` | Advance an active encounter |
| `end_combat` | Delete an active encounter |
| `set_initiative` | Set a combatant's initiative |
| `move_token` | Move a token in a scene |
| `apply_status_effect` | Add/remove a status effect on a token actor |

All core writes require `core.write`, the selected target's `writeEnabled: true` and remote user permissions. Socket.IO uses `modifyDocument`; `rest-api` executes the documented Foundry document APIs through its paired runtime. A `composite` keeps native core writes separate from relay integration bindings. Legacy `/api/*` is not a substitute for the native write path.

Destructive operations have no general undo. An interrupted write may return `outcome_unknown` even if it was applied. **Inspect the selected world before retrying; never assume retries are safe.**

Operation context checks stop unsent steps from continuing after a refresh,
reconnect, shutdown or completed call. Ordinary same-target work waits for
locally tracked provider requests even if a Python worker fails first. A local
timeout still cannot establish whether a remote mutation completed. Invalid
native acknowledgement data is also an unknown outcome, not success.

## Management and dynamic integration tools

| Tool | Purpose |
|---|---|
| `list_targets` | List configured targets and statuses even when remote worlds are offline |
| `get_target_status` | Inspect one target's identity, capabilities and integration failures |
| `list_systems` / `list_modules` | Inspect packaged integrations and their per-target readiness |
| `reconnect_target` | Explicitly reconnect just the selected target |

Initial experimental integration examples include `system_dnd5e_get_actor_data`, `system_pf2e_get_actor_data` and `module_item-piles_get_items`. Names preserve exact upstream IDs. These require the applicable runtime API and the target's `runtime.execute` capability; a manifest alone does not make a tool usable. The initial adapters are not claimed live-verified. See [Writing integrations](writing-integrations.md).

All currently shipped operations are read-only. Malformed packages are reported
in target integration status without suppressing unrelated valid packages.
Integration structured results retain their provenance wrapper; the advertised
schema preserves the result's local references and nested resource scope.

## MCP resources: 9 base definitions, target-qualified URLs

`src/tools/resources.ts` defines 9 resource types. The catalog only lists resources from **ready targets** whose provider supports their required capability. For example:

```text
foundry://targets/campaign-a/actors
foundry://targets/campaign-a/items
foundry://targets/campaign-b/combat
```

| Base resource | Contents |
|---|---|
| `foundry://actors` | Up to 100 actor summaries with IDs and total count |
| `foundry://items` | Up to 100 world item summaries with IDs and total count |
| `foundry://scenes` | Scenes |
| `foundry://scenes/current` | Active scene |
| `foundry://journals` | Journal entries |
| `foundry://users` | Users/presence |
| `foundry://combat` | Active combat state |
| `foundry://world/settings` | World/system settings |
| `foundry://system/diagnostics` | Legacy REST diagnostics, capability-dependent |

When only one target is configured, unqualified legacy resource aliases are also listed and remain readable, subject to readiness and capabilities. With multiple targets use `foundry://targets/<target_id>/<path>`; duplicate upstream document IDs across different worlds are not interchangeable. Core tool content keeps its original shape, with target provenance added in `_meta`; see [Backward compatibility](backward-compatibility.md).

## Not exposed as generic MCP capabilities

There is no unrestricted JavaScript execution tool, automatic cross-world synchronization, cross-world transaction support, universal rules lookup, or native pack-write tool. The shipped D&D 5e, PF2e and Item Piles adapters are intentionally narrow. Live Foundry/system/module compatibility must be demonstrated separately.

For a client connecting to a remote Linux Foundry host, see [Remote Linux](remote-linux.md) for networking and [Providers and targets](providers-and-targets.md) for the current target-scoped configuration.
