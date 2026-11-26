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
  `FOUNDRY_REST_URL`): the old REST-only mode against `FOUNDRY_URL`, with a
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

## Reference

- [FoundryVTT API](https://foundryvtt.com/api/)
- [Playwright Docs](https://playwright.dev/docs/intro)
- [MCP SDK](https://modelcontextprotocol.io/docs)
