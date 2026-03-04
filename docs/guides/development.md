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
