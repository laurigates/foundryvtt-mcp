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

`client.ts` selects transport purely by whether `FOUNDRY_API_KEY` is set:

- **`FOUNDRY_API_KEY` unset → Socket.IO mode** (default): authenticates with
  `FOUNDRY_USERNAME`/`FOUNDRY_PASSWORD` and loads full `worldData`.
- **`FOUNDRY_API_KEY` set → REST API mode**: connects to the REST module's
  `/api/status` instead. This is a transport **switch**, not an additive layer —
  it does not run alongside the Socket.IO `worldData` path.
- `USE_REST_MODULE` (seen in some `.env`/example files and the `test-connection`
  tips) is **not read** by `src/config/index.ts` — it is a no-op. Transport is
  decided solely by `apiKey` presence.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FOUNDRY_URL` | Yes | FoundryVTT server URL |
| `FOUNDRY_USERNAME` | Yes | FoundryVTT user |
| `FOUNDRY_PASSWORD` | Yes | FoundryVTT password |
| `FOUNDRY_USER_ID` | No | Bypass username→ID resolution |
| `FOUNDRY_API_KEY` | No | REST API module key (read-only diagnostics path) |
| `FOUNDRY_WRITE_ENABLED` | No | Enable game-state mutations — `true` required for the write tools (default `false`) |
| `LOG_LEVEL` | No | `debug` for verbose output |
| `FOUNDRY_TIMEOUT` | No | Request timeout (ms, default 10000) |

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
