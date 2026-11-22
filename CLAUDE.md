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

1. MCP discovery and calls use `src/tools/catalog.ts`.
2. The catalog resolves `target_id` through `src/sessions/`.
3. Core handlers consume the target's `FoundryCore` provider interface.
4. System/module adapters run in the target's optional Python worker and invoke
   fixed bindings through the same target's execution provider.
5. Responses include target and session provenance.

### Key Modules

| Module | Path | Purpose |
|--------|------|---------|
| Providers | `src/providers/` | Core port, per-instance cache, transport and execution backends |
| Sessions | `src/sessions/` | Target routing, independent lifecycle, identity and generation checks |
| Integrations | `src/integrations/` | Manifest loader, operation availability, Python bridge |
| Systems/modules | `systems/`, `modules/` | Separate Python adapters, bindings, manifests and READMEs |
| Auth | `src/foundry/auth.ts` | 4-step Socket.IO authentication |
| Config | `src/config/index.ts`, `src/config/targets.ts` | Validated environment and target configuration |
| Tools | `src/tools/definitions.ts` | MCP tool schemas |
| Catalog | `src/tools/catalog.ts` | Unified discovery, target routing and dispatch |
| Types | `src/foundry/types.ts` | FoundryVTT entity interfaces |

### Authentication & transport selection

Providers are selected per target before dispatch: `socketio`, `legacy-rest`,
`rest-api`, or `composite`. The composite explicitly combines native core access
with relay execution and verifies their remote identities. Operations never
switch providers or retry automatically after an uncertain mutation.

Without explicit target configuration, legacy environment settings become one
target: an API key selects the historical `/api/*` bridge; otherwise Socket.IO is
used. `FOUNDRY_PROVIDER` selects a provider explicitly. ThreeHats relay credentials
use separate `FOUNDRY_REST_*` settings. `USE_REST_MODULE` remains a no-op.

`src/foundry/client.ts` is only a compatibility export. Application code uses
provider interfaces. See [ADR-011](docs/adrs/0011-provider-session-integration-overhaul.md)
and the [configuration guide](docs/guides/providers-and-targets.md).

**The exposed tool list depends on the mode** (`src/tools/availability.ts`):
`tools/list` is filtered by transport, and the same rules gate `CallTool`.

- **Shared** tools (e.g. `roll_dice`, `search_actors`, `get_health_status`) are
  offered in both modes.
- **Socket-only** tools (e.g. `search_world`, `get_combat_state`,
  `get_journal`) are offered only in Socket.IO mode.
- **REST-only** tools (`search_compendium`, `get_recent_logs`, `search_logs`,
  `get_system_health`) are offered only in REST mode — they are **hidden** in
  Socket.IO mode, not served as empty results.
- **Write** tools (the 11 mutating tools, e.g. `move_token`, `end_combat`) are
  offered **only** in Socket.IO mode **and** with `FOUNDRY_WRITE_ENABLED=true`.

A direct `CallTool` for a hidden tool is rejected with a reason naming the
actual cause (writes disabled vs REST mode vs Socket.IO mode); a name absent
from the table falls through to the router's "Unknown tool" error.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FOUNDRY_URL` | Single native/legacy target | FoundryVTT server URL |
| `FOUNDRY_USERNAME` | Native authentication | FoundryVTT user |
| `FOUNDRY_PASSWORD` | Native authentication | FoundryVTT password |
| `FOUNDRY_USER_ID` | No | Bypass username→ID resolution |
| `FOUNDRY_API_KEY` | No | REST API module key (read-only diagnostics path) |
| `FOUNDRY_WRITE_ENABLED` | No | Enable game-state mutations — `true` required for the write tools (default `false`) |
| `LOG_LEVEL` | No | `debug` for verbose output |
| `FOUNDRY_TIMEOUT` | No | Request timeout (ms, default 10000) |
| `FOUNDRY_TARGETS_FILE` / `FOUNDRY_TARGETS_JSON` | No | Mutually exclusive explicit target configuration |
| `FOUNDRY_PYTHON_EXECUTABLE` | No | Optional integration runtime, default `python3` |

## Rules

See `.claude/rules/` for detailed guidelines:
- `development.md` — TDD workflow, commit conventions, build commands
- `testing.md` — Test tiers (unit, integration, E2E) and requirements
- `foundry-write-protocol.md` — transport (Socket.IO vs REST) and the `modifyDocument` write protocol
- `document-management.md` — Document detection and organization

## Reference

- [FoundryVTT API](https://foundryvtt.com/api/)
- [Playwright Docs](https://playwright.dev/docs/intro)
- [MCP SDK](https://modelcontextprotocol.io/docs)
