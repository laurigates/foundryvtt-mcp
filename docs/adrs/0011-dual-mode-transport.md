# ADR-011: Dual-Mode Transport: Socket.IO Primary, REST Bridge as Optional Augment

**Status**: Accepted (Lauri chose dual mode, 2026-11-24)
**Date**: 2026-11-24 (PR #330)
**Domain**: foundry-transport
**Amends**: [ADR-001](../blueprint/adrs/ADR-001-socketio-for-foundry-communication.md) (its "no custom module required" holds for core features only)
**Related**: [ADR-004](../blueprint/adrs/ADR-004-in-memory-world-state-cache.md), [ADR-010](0010-mutation-api-conventions.md), [ADR-012](0012-derived-values-from-source-data.md), [PRD-002](../blueprint/prds/PRD-002-optional-diagnostics.md)
**Issues**: #308, #309, #310, #327, #329, #331, #332, #333; laurigates/foundryvtt-local-rest-api#2, #4, #6, #8

## Context

### How the REST module left this repository and was forgotten

| Date | Event |
|------|-------|
| 2025-06-16 | The REST module was created inside this repo as `foundry-local-rest-api/` (7f8383a, ad8b506). |
| 2025-07-09 | The MCP's REST usage was made explicit (#66). |
| 2025-08-21 | A standalone local git repo for the module was created (570e493, 3fa8d58). The same day, #84 (4aae7d9) deleted the module from this repo "to its own repository… to improve focus and enable independent versioning", linking the placeholder URL `github.com/yourusername/foundryvtt-local-rest-api`. No GitHub repo was created then. |
| 2025-08-21..29 | The bridge server, the module's socket handler, tests and docs (about 60 files) were written in that local repo and never committed. The module's `docs/ARCHITECTURE_ISSUES.md` and `docs/SOLUTION.md` (2025-08-24) record why the design has two parts: module code runs in the browser and cannot serve HTTP, and `game.socket` relays only between browser clients. The result is a module running in a browser client plus a Node bridge server that serves HTTP and relays requests to it. |
| 2025-10-13 | Lauri forked cclloyd/planeshift (a third-party REST API server) as laurigates/planeshift, contributed upstream (cclloyd #3, #4) and used it while working on the MCP. planeshift#1 merged 2026-07-14. |
| 2025-11-16 | The harness moved to the felddy Docker image, with a bridge-server service built from the module's uncommitted working tree in `data/`. It worked locally without any commit. |
| 2026-02-10 | #89 added direct Socket.IO authentication as a world user. |
| 2026-03-03 | ADR-001 recorded Socket.IO direct as the transport, with "no custom module required". |
| 2026-11-23 | laurigates/foundryvtt-local-rest-api was created on GitHub (public). The WIP was committed as its PR #3 (API key scrubbed); the v14 port is its PR #4 (verified on v13 only). The gitops adoption PR is laurigates/gitops#442. |
| 2026-11-23/24 | The harness moved to Foundry 14.369 (felddy 14.369.1, dnd5e 6.0.6). MCP 1.6.1 (#306), 1.6.2 (#309) and 1.6.3 (#326) were released. |

Once Socket.IO authentication worked, the module looked unnecessary: Socket.IO delivers the whole world, so it seemed to cover everything the module did. Lauri's account is that he did not see a capability gap, so the module was set aside. The docs kept pointing at an install URL that #84 had already broken (#327).

### The capability gap

The Socket.IO `world` payload carries document **source** data. Several things exist only inside a running Foundry client, and Socket.IO from outside cannot reach them:

- **Prepared values.** dnd5e computes AC, max HP for characters, save and skill totals, and every Active Effect result in `prepareData`, which runs only in a browser client. #308 and #309 surfaced this as "Unknown" AC and +0 modifiers. #309 computed what is exact from source data (ability modifiers, level, proficiency; see [ADR-012](0012-derived-values-from-source-data.md)); the rest cannot be computed without reimplementing the system.
- **Compendium search**, which needs pack indexes loaded in a client.
- **Server logs and system health**, which need code running inside Foundry.
- **Foundry's own dice engine** (`Roll`), which the local roller only approximates.

Before PR #330, `FOUNDRY_API_KEY` was a transport switch: with it set, the MCP spoke only REST to `FOUNDRY_URL` and lost writes, combat, journals, chat and live updates. Neither mode could serve everything.

## Decision

Socket.IO stays the primary transport. The REST bridge (laurigates/foundryvtt-local-rest-api: the Foundry module plus its Node bridge server, `:3030` by default) becomes an optional augment that runs alongside it.

### Mode selection

`src/foundry/transport.ts` (`resolveTransportPlan`) decides the mode from configuration alone. An empty variable counts as unset.

| Configuration | Mode |
|---------------|------|
| No `FOUNDRY_API_KEY` | `socket`: Socket.IO only, the default |
| `FOUNDRY_API_KEY` + `FOUNDRY_REST_URL` + Socket.IO credentials | `dual` |
| `FOUNDRY_API_KEY` without Socket.IO credentials | `rest`: deprecated REST-only mode, warning at startup |
| `FOUNDRY_API_KEY` + credentials, no `FOUNDRY_REST_URL` | `rest`: deprecated, `FOUNDRY_URL` treated as the bridge, warning naming `FOUNDRY_REST_URL` |
| `FOUNDRY_REST_URL` without `FOUNDRY_API_KEY` | `socket`, warning that the augment stays off |

The REST-only mode is kept so existing configurations behave as before, and deprecated: it has no writes, combat, journals, chat or live updates. A key plus Socket.IO credentials without `FOUNDRY_REST_URL` stays in this legacy mode on purpose, with the warning, instead of being promoted to dual mode with `FOUNDRY_URL` as the bridge: such a configuration was written for REST-only mode, where `FOUNDRY_URL` points at the bridge, so it cannot also be the Socket.IO server.

### Per-capability source selection

`src/foundry/capabilities.ts` is the single table. For each capability it lists the sources that can serve it (`socket`, `rest`, `local`) and the preferred one, and it maps every MCP tool to its capabilities. `src/tools/availability.ts` derives `tools/list` and the CallTool gate from it (replacing the per-tool `TOOL_ACCESS` table that #290 introduced), and `FoundryClient` routes reads with it.

- Base actor data, items, scenes and world info: Socket.IO preferred.
- Prepared actor values (`actor-derived`): REST preferred, overlaid on the Socket.IO actor (`overlayDerivedValues`).
- Compendium search, logs, system health: REST only.
- Writes, combat, chat, users, journals and the other snapshot reads: Socket.IO only.
- Dice: Foundry's roller via the bridge, then the local roller.

### Fallback

In dual mode a bridge call that fails, times out or returns an unexpected shape yields the Socket.IO answer, or the existing "unavailable" label when there is none. Each capability's failure is logged once until a call succeeds again. Failures that would cost the same wait on the next call start a 30-second pause (`REST_RETRY_AFTER_MS`):

| Bridge failure | Pause |
|---|---|
| No HTTP response (refused, reset, DNS, client timeout) | Every bridge call |
| HTTP 5xx on the connect probe (`/api/world`) | Every bridge call |
| HTTP 5xx on a call | That capability only |
| HTTP 4xx, the module's `success: false`, or an unreadable body | None: that call falls back, the next one asks again |

The 5xx case is a bridge that runs while no GM browser client hosts the module: it answers 500 only after its own `REQUEST_TIMEOUT` (5 s by default). Without the pause, every `get_actor_details`, `search_actors` and `roll_dice` call would wait that long. With it, the first call per capability in each 30-second window pays the wait and the rest fall back at once. Dice keep the bridge-first order (Foundry's `Roll`, then the local roller) under the same rule. `connect()` never fails because of the bridge, and no Socket.IO tool is hidden while the bridge is down. `get_health_status` labels the bridge by the last request: unreachable (no answer), answering with errors (5xx), last request rejected (4xx) or unusable response, each with its error, and lists the running pauses.

### Mapping the bridge's responses

`src/foundry/rest-mappers.ts` unwraps the module's `{success, data}` envelope and maps each route explicitly (#310). An unknown shape is rejected with an error naming the route and is not retried.

## Consequences

### What each mode can and cannot do

The tool and resource cells are recorded in [docs/guides/capabilities.md](../guides/capabilities.md) and pinned by the capability matrix test.

| | `socket` | `dual` | `rest` (deprecated) |
|---|---|---|---|
| Writes (11 tools, with `FOUNDRY_WRITE_ENABLED=true`) | Yes | Yes | No |
| Combat, chat, users, journals, world search, refresh | Yes | Yes | No |
| Live cache updates from broadcasts | Yes | Yes | No |
| Prepared AC, max HP, save totals | Exact-from-source subset only (ADR-012) | From the bridge once foundryvtt-local-rest-api#8 is fixed; until then the Socket.IO answer | Once foundryvtt-local-rest-api#8 is fixed |
| Compendium search, logs, system health | No (tools hidden) | Yes, once the bridge defects are fixed | Yes, once the bridge defects are fixed |
| Dice engine | Local roller | Foundry `Roll`, local fallback | Foundry `Roll` |
| Needs the module, bridge server and a logged-in GM browser | No | Yes | Yes |

### The parity tests guard the difference

- `src/tools/__tests__/capability-matrix.test.ts`: a reviewed table of all 33 tools and 9 resources in each mode. Tool cells come from the gate and the source table; resource cells are observed through a `FoundryClient` with Socket.IO and the bridge mocked.
- `src/foundry/__tests__/parity-contract.test.ts` with `src/foundry/parity.ts`: one dnd5e scenario through both mappers. Shared fields must agree, the one-sided fields must equal `KNOWN_GAPS` exactly, and dual mode must fill every REST-only actor field.
- `tests/integration/parity.integration.test.ts`: the same comparison against a live Foundry and bridge. It skips unless credentials, the key and two local URLs are set. **Not yet run live.**

Each failure names the files to update together: the matrix, `KNOWN_GAPS`, `docs/guides/capabilities.md`, and this ADR when a gap opens or closes.

### Known gaps at the time of writing

- **Bridge defects in actor reads ([laurigates/foundryvtt-local-rest-api#8](https://github.com/laurigates/foundryvtt-local-rest-api/issues/8))**: through the bridge, `GET /api/actors/:id` always fails the module's validation with "id is required", and actor search ignores `query`, `type` and `limit` and returns the first 50 actors. Until it is fixed, dual mode cannot deliver prepared actor values: `get_actor_details` never gets them, and the `search_actors` overlay covers only the requested actors that happen to be among those 50. The fallback still returns the correct Socket.IO data with its "unavailable" labels. A fix is in [laurigates/foundryvtt-local-rest-api#4](https://github.com/laurigates/foundryvtt-local-rest-api/pull/4); it applies once merged.
- **Bridge defects in diagnostics and compendium ([laurigates/foundryvtt-local-rest-api#6](https://github.com/laurigates/foundryvtt-local-rest-api/issues/6))**: `/api/diagnostics/*` is routed to an action the module rejects, and there is no compendium route. Until it is fixed, logs, system health and compendium search report as unavailable in dual mode even with a working bridge; the 500 from the diagnostics route pauses `system-health` for 30 seconds. The compendium and diagnostics mappings match the shapes the module's PR #4 adds (read at its head 71d01b1): both wrap their payload as `{ success, data }`. [laurigates/foundryvtt-local-rest-api#4](https://github.com/laurigates/foundryvtt-local-rest-api/pull/4) also addresses this issue; it applies once merged. The `/api/scenes/current` item in that issue is stale: the bridge already routes it ahead of the scene-id pattern (a60decf on the module's `feat/v14-port`; on its `main` since its PR #3).
- **One-sided fields** (`KNOWN_GAPS` in `src/foundry/parity.ts`). Actor: `hp.max`, `ac.value` and `abilities.*.save` come only from REST (prepared values); `hp.temp` and `attributes.prof` only from Socket.IO (the bridge route does not send them). Item: price, weight, quantity, equipped and identified only from REST (the Socket.IO mapper does not read them); `rarity` is a REST default; `description` is Socket.IO-only on search. World: the module list only from REST.
- **Declared but unused REST fallback** for actors, items, scenes and world info in dual mode (#332).
- **REST-only mode lists resources it cannot fill** (scenes, journals, users, combat; #333).
- **Helpers not yet dual-aware**: `test-connection`, the setup wizard and `DiagnosticSystem` still treat the key as REST-only mode (#329).
- **Live verification is pending**: nothing in PR #330 ran against a live Foundry or bridge.

### Operational cost of the augment

- The bridge answers only while a **GM is logged in through a browser** with the module enabled: that client runs the module code that reads the prepared data. With no GM client, the bridge answers each request with HTTP 500 after its `REQUEST_TIMEOUT`, and dual mode serves the Socket.IO answers, paying that wait once per capability every 30 seconds (see Fallback). Lowering the bridge's `REQUEST_TIMEOUT` shortens that first wait.
- The bridge server logs in to Foundry as its own world user and must be run and kept up separately.
- The module has no published release yet (laurigates/foundryvtt-local-rest-api#2), so there is no manifest URL to install from; installation is from a checkout.

## Alternatives Considered

- **Keep `FOUNDRY_API_KEY` as a transport switch.** Rejected: each mode lacks something the other has.
- **REST only, retire Socket.IO.** Rejected: no writes, no live updates, and a hard dependency on a GM browser session.
- **Reimplement dnd5e `prepareData` in the MCP.** Rejected: system- and version-specific, and Active Effects make it open-ended. ADR-012 computes only what is exact.
- **Use planeshift instead of the local bridge.** Not chosen here: the local bridge is Lauri's own code, already wired into the harness, and the mappers target its contract. The capability table would accept another REST source.
