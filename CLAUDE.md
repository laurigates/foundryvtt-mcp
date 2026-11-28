# Project: foundryvtt-mcp

Model Context Protocol (MCP) server bridging AI assistants with FoundryVTT tabletop gaming software.

## Tech Stack

- **Language**: TypeScript (ES modules, `.js` imports for MCP SDK compatibility)
- **Runtime**: Node.js (Bun as package manager)
- **Test**: Vitest (unit + integration), Playwright (E2E)
- **Lint/Format**: Biome (linting + formatting)
- **Validation**: Zod schemas

## Essential Commands

```bash
bun run build          # Compile TypeScript
bun run dev            # Development mode with hot reload
bun test               # Unit tests (Vitest)
bun run test:integration # Integration tests (needs :30001 container + .env.integration — prefer `just test-integration-docker`)
bun run test:e2e       # E2E tests (Playwright, headless)
bun run lint           # Lint code (Biome)
bun run lint:fix       # Auto-fix lint issues
bun run format         # Format code (Biome)
bun run test-connection # Test MCP→FoundryVTT connection
```

## Architecture

### Data Flow

1. AI assistant calls MCP tool → `src/tools/router.ts`
2. Router dispatches to handler → `src/tools/handlers/`
3. Handler queries cached worldData → `src/foundry/client.ts`
4. Response returned as MCP result

### Key Modules

| Module | Path | Purpose |
|--------|------|---------|
| Client | `src/foundry/client.ts` | Socket.IO connection, world state cache |
| Auth | `src/foundry/auth.ts` | 4-step Socket.IO authentication |
| Config | `src/config/index.ts` | Zod-validated environment config |
| Tools | `src/tools/definitions.ts` | MCP tool schemas |
| Router | `src/tools/router.ts` | Request→handler dispatch |
| Types | `src/foundry/types.ts` | FoundryVTT entity interfaces |

### Authentication & transport selection

`src/foundry/transport.ts` (`resolveTransportPlan`) picks one of three modes
from configuration alone (empty values count as unset); the design is
[ADR-011](docs/adrs/0011-dual-mode-transport.md):

- **`socket`** (default, no `FOUNDRY_API_KEY`): authenticates with
  `FOUNDRY_USERNAME`/`FOUNDRY_PASSWORD` and loads the live `worldData` cache.
- **`dual`** (`FOUNDRY_API_KEY` + `FOUNDRY_REST_URL` + Socket.IO credentials):
  Socket.IO stays primary; the REST bridge
  ([laurigates/foundryvtt-local-rest-api](https://github.com/laurigates/foundryvtt-local-rest-api),
  module + Node bridge server on `:3030`) augments it with prepared dnd5e values,
  Foundry's dice engine, compendium search, logs and system health. A failed
  bridge call falls back to the Socket.IO answer; `connect()` never fails
  because of the bridge. A transport failure pauses the whole bridge, a 5xx
  (e.g. no GM browser client) pauses that capability, both for 30 s; a 4xx
  pauses nothing. The bridge fixes the prepared values and the
  diagnostics/compendium routes depend on (foundryvtt-local-rest-api#8, #6)
  shipped in its v2.1.0; dual mode was checked by hand against a live world
  on 2026-11-26 (see `docs/guides/capabilities.md`).
- **`rest`** (deprecated: the key without Socket.IO credentials, or without
  `FOUNDRY_REST_URL`): the old REST-only *mode* (the bridge itself is current;
  only using it as the sole transport is deprecated) against `FOUNDRY_URL`, with a
  startup warning. It probes the bridge's authenticated `/api/world`
  (`probeRestModule()` in `src/foundry/rest-probe.ts`); `/api/status` is served
  unauthenticated by Foundry core, so it proves neither the module nor the key.
- `USE_REST_MODULE` (seen in some `.env`/example files) is **not read** by
  `src/config/index.ts` — it is a no-op.

**One table decides sources and tool exposure**: `src/foundry/capabilities.ts`
lists, per capability, the sources that can serve it and the preferred one, and
maps every tool to its capabilities. `src/tools/availability.ts` derives
`tools/list` and the CallTool gate from it; `FoundryClient` routes reads with it.
Write tools are offered only where Socket.IO is connected **and**
`FOUNDRY_WRITE_ENABLED=true`. A direct `CallTool` for a hidden tool is rejected
with a reason naming the actual cause; a name absent from the table falls
through to the router's "Unknown tool" error. The per-mode result is recorded in
`docs/guides/capabilities.md` and pinned by
`src/tools/__tests__/capability-matrix.test.ts`; field differences between the
transports are `KNOWN_GAPS` in `src/foundry/parity.ts`.

## Architecture boundaries (read before proposing a design change)

Decisions, not gaps. Each links the ADR that owns it; a change to one starts
as a new ADR, discussed in an issue, before code.

- **Two canonical transports.** Socket.IO to Foundry is primary and carries
  every write; [laurigates/foundryvtt-local-rest-api](https://github.com/laurigates/foundryvtt-local-rest-api)
  is the augment in dual mode. The bridge is **not** legacy: only the
  REST-only *mode* is deprecated. Third-party relays are not a supported
  transport. [ADR-011](docs/adrs/0011-dual-mode-transport.md).
- **Writes only over Socket.IO `modifyDocument`**, behind
  `FOUNDRY_WRITE_ENABLED=true`. Never over REST.
  [ADR-011](docs/adrs/0011-dual-mode-transport.md),
  [ADR-010](docs/adrs/0010-mutation-api-conventions.md),
  `.claude/rules/foundry-write-protocol.md`.
- **No arbitrary JavaScript.** Code that must run inside Foundry is a named
  operation in a companion Foundry module, answered under the bridge's
  response contract
  ([bridge ADR-0003](https://github.com/laurigates/foundryvtt-local-rest-api/blob/main/docs/adrs/0003-response-contract.md),
  [ADR-0006](https://github.com/laurigates/foundryvtt-local-rest-api/blob/main/docs/adrs/0006-named-operations-only.md)).
  No `/execute-js`-style route, not even as an opt-in.
  [ADR-015](docs/adrs/0015-extension-boundaries.md).
- **One capability table.** New tools and extension operations are entries in
  `CAPABILITY_SOURCES` / `TOOL_CAPABILITIES` (`src/foundry/capabilities.ts`);
  availability and the parity tripwires derive from it. No parallel provider
  or availability layer. [ADR-015](docs/adrs/0015-extension-boundaries.md).
- **Node only.** TypeScript on Node, bun as package manager; no Python or
  other runtime dependency. [ADR-015](docs/adrs/0015-extension-boundaries.md).
- **Extension packages**: allowlisted in configuration (no directory
  auto-discovery), Foundry-style `minimum`/`verified`/`maximum` ranges for the
  Foundry generation and the upstream package, `verified` only for a build
  actually run, no silent fallback to another generation, one shared strict
  schema validator. [ADR-015](docs/adrs/0015-extension-boundaries.md).
- **Foundry v13 and v14 both supported** by accepting both wire shapes.
  [ADR-014](docs/adrs/0014-foundry-v13-v14-wire-shapes.md).
- **dnd5e derived values**: compute only what is exact from source data; the
  bridge supplies prepared values. [ADR-012](docs/adrs/0012-derived-values-from-source-data.md).
- **Small PRs, one concern each**, against current `main`; see
  [CONTRIBUTING.md](CONTRIBUTING.md).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FOUNDRY_URL` | Yes | FoundryVTT server URL |
| `FOUNDRY_USERNAME` | Socket.IO, dual | FoundryVTT user |
| `FOUNDRY_PASSWORD` | Socket.IO, dual | FoundryVTT password |
| `FOUNDRY_USER_ID` | No | Bypass username→ID resolution |
| `FOUNDRY_API_KEY` | No | REST bridge key; with `FOUNDRY_REST_URL` and credentials → dual mode |
| `FOUNDRY_REST_URL` | No | REST bridge server URL (e.g. `http://localhost:3030`) |
| `FOUNDRY_WRITE_ENABLED` | No | Enable game-state mutations — `true` required for the write tools (default `false`) |
| `LOG_LEVEL` | No | `debug` for verbose output |
| `FOUNDRY_TIMEOUT` | No | Request timeout (ms, default 10000) |

## Rules

See `.claude/rules/` for detailed guidelines:
- `development.md` — TDD workflow, commit conventions, build commands
- `testing.md` — Test tiers (unit, integration, E2E) and requirements
- `foundry-write-protocol.md` — transports (Socket.IO primary, REST bridge augment) and the `modifyDocument` write protocol
- `document-management.md` — Document detection and organization
- `release-pipeline.md` — release-please and npm publishing
- `esm-entrypoint-env-loading.md`, `scripts-typecheck-gap.md` — known build traps

Architecture decisions: [`docs/adrs/`](docs/adrs/README.md) (ADR-001..006 in
`docs/blueprint/adrs/`).

## Reference

- [FoundryVTT API](https://foundryvtt.com/api/)
- [Playwright Docs](https://playwright.dev/docs/intro)
- [MCP SDK](https://modelcontextprotocol.io/docs)
