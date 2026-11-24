# ADR-011: Dual-Mode Transport: Socket.IO Primary, REST Bridge as Optional Augment

**Status**: Accepted (Lauri chose dual mode, 2026-11-24)
**Date**: 2026-11-24 (PR #330)
**Domain**: foundry-transport
**Amends**: [ADR-001](../blueprint/adrs/ADR-001-socketio-for-foundry-communication.md) (its "no custom module required" holds for core features only)
**Related**: [ADR-004](../blueprint/adrs/ADR-004-in-memory-world-state-cache.md), [ADR-010](0010-mutation-api-conventions.md), [ADR-012](0012-derived-values-from-source-data.md), [PRD-002](../blueprint/prds/PRD-002-optional-diagnostics.md)
**Issues**: #308, #309, #310, #327, #329, #331, #332, #333; laurigates/foundryvtt-local-rest-api#2, #4, #6

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

The REST-only mode is kept so existing configurations behave as before, and deprecated: it has no writes, combat, journals, chat or live updates.

### Per-capability source selection

`src/foundry/capabilities.ts` is the single table. For each capability it lists the sources that can serve it (`socket`, `rest`, `local`) and the preferred one, and it maps every MCP tool to its capabilities. `src/tools/availability.ts` derives `tools/list` and the CallTool gate from it (replacing the per-tool `TOOL_ACCESS` table that #290 introduced), and `FoundryClient` routes reads with it.

- Base actor data, items, scenes and world info: Socket.IO preferred.
- Prepared actor values (`actor-derived`): REST preferred, overlaid on the Socket.IO actor (`overlayDerivedValues`).
- Compendium search, logs, system health: REST only.
- Writes, combat, chat, users, journals and the other snapshot reads: Socket.IO only.
- Dice: Foundry's roller via the bridge, then the local roller.

### Fallback

In dual mode a bridge call that fails, times out or returns an unexpected shape yields the Socket.IO answer, or the existing "unavailable" label when there is none. Each capability's failure is logged once until a call succeeds again. After a network failure the bridge is skipped for 30 seconds (`REST_RETRY_AFTER_MS`). `connect()` never fails because of the bridge, and no Socket.IO tool is hidden while the bridge is down.

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
| Prepared AC, max HP, save totals | Exact-from-source subset only (ADR-012) | Yes, from the bridge | Yes |
| Compendium search, logs, system health | No (tools hidden) | Yes, once the bridge defects are fixed | Yes, once the bridge defects are fixed |
| Dice engine | Local roller | Foundry `Roll`, local fallback | Foundry `Roll` |
| Needs the module, bridge server and a logged-in GM browser | No | Yes | Yes |

### The parity tests guard the difference

- `src/tools/__tests__/capability-matrix.test.ts`: a reviewed table of all 33 tools and 9 resources in each mode. Tool cells come from the gate and the source table; resource cells are observed through a `FoundryClient` with Socket.IO and the bridge mocked.
- `src/foundry/__tests__/parity-contract.test.ts` with `src/foundry/parity.ts`: one dnd5e scenario through both mappers. Shared fields must agree, the one-sided fields must equal `KNOWN_GAPS` exactly, and dual mode must fill every REST-only actor field.
- `tests/integration/parity.integration.test.ts`: the same comparison against a live Foundry and bridge. It skips unless credentials, the key and two local URLs are set. **Not yet run live.**

Each failure names the files to update together: the matrix, `KNOWN_GAPS`, `docs/guides/capabilities.md`, and this ADR when a gap opens or closes.

### Known gaps at the time of writing

- **Bridge defects (laurigates/foundryvtt-local-rest-api#6)**: `/api/diagnostics/*` is routed to an action the module rejects, `/api/scenes/current` is treated as a scene id, and there is no compendium route. Until it is fixed, logs, system health and compendium search report as unavailable in dual mode even with a working bridge. The compendium mapping assumes the shape of the module's other search routes.
- **One-sided fields** (`KNOWN_GAPS` in `src/foundry/parity.ts`). Actor: `hp.max`, `ac.value` and `abilities.*.save` come only from REST (prepared values); `hp.temp` and `attributes.prof` only from Socket.IO (the bridge route does not send them). Item: price, weight, quantity, equipped and identified only from REST (the Socket.IO mapper does not read them); `rarity` is a REST default; `description` is Socket.IO-only on search. World: the module list only from REST.
- **Declared but unused REST fallback** for actors, items, scenes and world info in dual mode (#332).
- **REST-only mode lists resources it cannot fill** (scenes, journals, users, combat; #333).
- **Helpers not yet dual-aware**: `test-connection`, the setup wizard and `DiagnosticSystem` still treat the key as REST-only mode (#329).
- **Live verification is pending**: nothing in PR #330 ran against a live Foundry or bridge.

### Operational cost of the augment

- The bridge answers only while a **GM is logged in through a browser** with the module enabled: that client runs the module code that reads the prepared data. A headless server with no GM client gives dual mode the Socket.IO answers only.
- The bridge server logs in to Foundry as its own world user and must be run and kept up separately.
- The module has no published release yet (laurigates/foundryvtt-local-rest-api#2), so there is no manifest URL to install from; installation is from a checkout.

## Alternatives Considered

- **Keep `FOUNDRY_API_KEY` as a transport switch.** Rejected: each mode lacks something the other has.
- **REST only, retire Socket.IO.** Rejected: no writes, no live updates, and a hard dependency on a GM browser session.
- **Reimplement dnd5e `prepareData` in the MCP.** Rejected: system- and version-specific, and Active Effects make it open-ended. ADR-012 computes only what is exact.
- **Use planeshift instead of the local bridge.** Not chosen here: the local bridge is Lauri's own code, already wired into the harness, and the mappers target its contract. The capability table would accept another REST source.
