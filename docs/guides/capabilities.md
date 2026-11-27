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

`src/tools/availability.ts` retains transport-only availability helpers for compatibility and corresponding tests. It is **not** the target-aware MCP dispatch gate. A tool visible in the global catalog may be unavailable on an individual target.

## Connection modes

Connection modes are resolved within a target. Provider kinds have separate capabilities and execution contracts:

| Provider | How it connects | Relevant operations |
|---|---|---|
| `socketio` | Authenticated native Foundry session with live world-data cache; optional historical REST augmentation | Core read/cache operations; native writes via `modifyDocument` if enabled; bridge-backed capabilities when configured |
| `legacy-rest` | Historical `/api/*` bridge selected by a legacy environment key without a full native-plus-bridge configuration | Shared core reads, compendium search and legacy REST diagnostics; no native Socket.IO world-cache capability |
| `rest-api` | Paired ThreeHats relay, runtime bindings and refreshed world snapshot | Core read/cache and optional target-enabled document writes through Foundry runtime APIs; runtime integration bindings |
| `composite` | Native Socket.IO core plus a separately authenticated paired relay | Socket.IO core operations and relay integration execution for one identity-verified world |

`FOUNDRY_API_KEY` is **not** a relay credential; `FOUNDRY_REST_API_KEY` supplies the legacy-environment relay key. Explicit targets select the provider using `provider.kind`. A composite verifies consistent world/origin/system identity; neither composite nor standalone relay silently falls back to another transport after an uncertain write. See [configuration](configuration.md) and [providers/targets](providers-and-targets.md).

Capabilities used for the core include `core.read`, `core.cache`, `core.write`, `compendium.read` and `diagnostics.read`. `runtime.execute` is required for executable system/module integrations; operations may additionally depend on a specific active system or module. A write needs a target-local opt-in **and** suitable provider/runtime/Foundry permissions.

A `composite` is ready only when both connections are available. Its core tools
are also withheld if the relay fails; no degraded native-only mode is provided.
Configure an independent `socketio` target for separately available native access.

### Optional historical bridge on a Socket.IO target

`restUrl` and `restApiKey` add the historical `/api/*` bridge to one native target. This corresponds to upstream's dual transport mode and is independent of the ThreeHats relay used for integration bindings. The legacy environment selects this native-plus-bridge combination when `FOUNDRY_API_KEY`, `FOUNDRY_REST_URL` and native credentials are present. Explicit targets use only their own provider configuration. In this mode every bridge call is bracketed by an identity probe (`GET /api/world`), so the bridge cannot answer for a different world, system or origin; see [ADR-0011](../adrs/0011-dual-mode-transport.md).

Socket.IO continues to serve the world cache, combat, journals and native writes. The optional bridge supplies prepared actor values, Foundry's dice engine, compendium search and REST diagnostics. Failed reads fall back where a native/local answer exists. A bridge transport failure pauses bridge requests, while a server error pauses that capability, for 30 seconds. Neither mechanism changes target or retries an uncertain write. Native reads remain available when the optional bridge is unavailable; this differs from the two required connections of a `composite` provider.

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
| `search_compendium` | Pack search with filters | Requires `compendium.read` from a historical bridge, standalone or augmenting Socket.IO |
| `get_recent_logs` | Historical REST backend logs | Requires `diagnostics.read` |
| `search_logs` | Historical REST backend log search | Requires `diagnostics.read` |
| `get_system_health` | Historical REST backend health metrics | Requires `diagnostics.read` |

`search_world` uses `src/foundry/world-search.ts` and returns the matching field/excerpt for content hits. It searches selected actor descriptions/biographies, item descriptions, scene annotations/tokens and journal page content, with HTML converted to plain text. It does not index arbitrary module fields or use an external search engine.

### Source data and prepared game values

The native `world` snapshot contains stored source data rather than all values prepared by a running game system. Actor projections stay owned by the selected system package and Foundry generation. D&D 5e values that can be derived from source data include ability modifiers, character class levels and proficiency; runtime-dependent armor class, character maximum HP and saving-throw totals must not be presented as invented defaults. The optional historical bridge can supply its prepared actor fields. A missing field remains unavailable when no valid source provides it. See [derived values](../adrs/0012-derived-values-from-source-data.md).

Native cache updates follow both `modifyDocument` broadcasts and v14 `modifyDocumentBatch` events. An explicit `refresh_world_data` resynchronizes after missed updates; generic cache updates do not fully cover synthetic unlinked-token actors. See [live cache](../adrs/0013-live-world-cache-from-broadcasts.md) and [version-specific wire shapes](../adrs/0014-foundry-v13-v14-wire-shapes.md).

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

Foundry v14 may acknowledge a native write with `{ results: [...] }`, containing a primary response and side effects. The provider checks all response entries for errors and returns the primary result. This does not turn multiple target operations into a transaction or authorize replay after a timeout.

## Management and dynamic integration tools

| Tool | Purpose |
|---|---|
| `list_targets` | List configured targets and statuses even when remote worlds are offline |
| `get_target_status` | Inspect one target's identity, capabilities and integration failures |
| `list_systems` / `list_modules` | Inspect packaged integrations, selected/available Foundry generations, variant errors and per-target readiness |
| `reconnect_target` | Explicitly reconnect just the selected target |

Dynamic names preserve exact upstream IDs through `system_{id}_{operation}` and
`module_{id}_{operation}`. Each operation requires its applicable runtime API and
the target's `runtime.execute` capability; a manifest alone does not make a tool
usable. See the [system bridge catalog](../bridges/systems.md) and
[module bridge catalog](../bridges/modules.md) for package versions, source pins,
Foundry requirements and links to operation references.

Packages use `systems/<id>/<generation>/` and `modules/<id>/<generation>/`.
Only the exact Foundry generation is selected on each target, before Python
imports or runtime probes. Missing generations do not fall back. New adapters
are discovered by copying a complete directory; no registry edit is required.

The system adapters expose explicit data reads, rule-aware rolls and selected
mutations. Module adapters expose their own domain workflows. Every operation has
its own input/output contract and read/write classification; callers cannot supply
a generic API-method name or JavaScript. Rolls with chat or other side effects
require target write opt-in, as do document and resource changes. Runtime document
ownership and any stronger package-specific permission still apply.

Original raw reads preserve their existing capability-based contracts inside
their selected generation. New
operations enforce the inspected upstream version and narrower Foundry/API gates.
An unknown/different version is not treated as compatible. These are readiness
checks, not live-tested claims; packages remain experimental. The
[call selection guide](core-system-module-calls.md) explains why a core document
patch, a system action and a module workflow are distinct, without a global
priority or automatic mutation fallback.

Malformed packages are reported in target integration status without suppressing
unrelated valid packages. Integration structured results retain their provenance
wrapper; the advertised schema preserves the result's local references and nested
resource scope.

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
