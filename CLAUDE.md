# Project: foundry-mcp-server

Model Context Protocol (MCP) server bridging AI assistants with FoundryVTT tabletop gaming software.

## Tech Stack

- **Language**: TypeScript (ES modules, `.js` imports for MCP SDK compatibility)
- **Runtime**: Node.js
- **Test**: Vitest (unit), Playwright (E2E)
- **Lint**: ESLint (functional programming patterns)
- **Validation**: Zod schemas

## Essential Commands

```bash
npm run build          # Compile TypeScript
npm run dev            # Development mode with hot reload
npm test               # Unit tests (Vitest)
npm run test:e2e       # E2E tests (Playwright, headless)
npm run lint           # Lint code
npm run test-connection # Test MCP→FoundryVTT connection
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

### Authentication

- **Primary**: Socket.IO with `FOUNDRY_USERNAME`/`FOUNDRY_PASSWORD`
- **Optional**: `FOUNDRY_API_KEY` for REST API diagnostics (5 extra tools)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FOUNDRY_URL` | Yes | FoundryVTT server URL |
| `FOUNDRY_USERNAME` | Yes | FoundryVTT user |
| `FOUNDRY_PASSWORD` | Yes | FoundryVTT password |
| `FOUNDRY_USER_ID` | No | Bypass username→ID resolution |
| `FOUNDRY_API_KEY` | No | REST API module key |
| `LOG_LEVEL` | No | `debug` for verbose output |
| `FOUNDRY_TIMEOUT` | No | Request timeout (ms, default 10000) |

## Rules

See `.claude/rules/` for detailed guidelines:
- `development.md` — TDD workflow, commit conventions, build commands
- `testing.md` — Unit and E2E test requirements
- `document-management.md` — Document detection and organization

## Reference

- [FoundryVTT API](https://foundryvtt.com/api/)
- [Playwright Docs](https://playwright.dev/docs/intro)
- [MCP SDK](https://modelcontextprotocol.io/docs)
