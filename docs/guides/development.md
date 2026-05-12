# Development Guide

## Project Structure

```
src/
├── config/              # Zod-validated configuration
├── foundry/
│   ├── auth.ts          # Socket.IO 4-step authentication
│   ├── client.ts        # FoundryVTT client with worldData cache
│   └── types.ts         # TypeScript interfaces + WorldData
├── tools/
│   ├── definitions.ts   # Tool schemas by category
│   ├── router.ts        # Tool request routing
│   ├── resources.ts     # MCP resource definitions
│   └── handlers/        # Per-tool handler implementations
├── diagnostics/         # Optional REST API diagnostics
├── utils/               # Logger, cache utilities
└── index.ts             # MCP server entry point
```

## Adding New Tools

1. Define tool schema in `src/tools/definitions.ts`
2. Add handler in `src/tools/handlers/`
3. Wire the handler in `src/tools/router.ts`
4. Add TypeScript types in `src/foundry/types.ts` if needed
5. Test with your AI assistant

## Testing

```bash
# Unit tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Lint code
npm run lint

# E2E tests (requires running FoundryVTT)
npm run test:e2e
```

### Smoke tests

Two smoke tests verify the server boots end-to-end without a live FoundryVTT.
They run in CI on every PR and catch failure modes that the mocked Vitest
suite cannot:

```bash
npm run smoke        # Spawn dist/index.js, verify the startup banner on stderr
npm run smoke:pack   # npm pack -> install into a fresh consumer -> verify banner
```

`smoke` covers construction-time and import-time regressions (SDK shape
changes, ESM resolution). `smoke:pack` additionally validates that the
`package.json` `files` glob ships every runtime path the entrypoint needs —
the kind of regression that only surfaces for users running `npx foundryvtt-mcp`
or `bunx foundryvtt-mcp`, not for anyone running the source tree.

## Building

```bash
# Development build
npm run build

# Clean build
npm run clean && npm run build

# Development mode with hot reload
npm run dev
```

## API Documentation (TypeDoc)

Complete API documentation is auto-generated from TypeScript source code and JSDoc comments.

```bash
npm run docs        # Generate documentation
npm run docs:serve  # Generate and serve locally
```

### What's Documented

- **FoundryClient API** — complete client documentation with examples
- **TypeScript Interfaces** — all data structures and type definitions
- **Configuration** — environment variables and setup options
- **Utilities** — helper functions and logging
- **Usage Examples** — code samples for common operations

The documentation is automatically updated via GitHub Actions when source code changes.
