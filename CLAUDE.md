# CLAUDE.md

This file provides guidance to Claude Code when working with the FoundryVTT MCP server repository.

## Project Overview

This is a **Model Context Protocol (MCP) server** that bridges AI assistants with FoundryVTT tabletop gaming software.

## Essential Commands

```bash
npm run build          # Compile TypeScript
npm run dev           # Development mode with hot reload
npm test              # Run tests
npm run lint          # Lint code
npm run test:e2e      # Run Playwright E2E tests
fvtt launch          # Start FoundryVTT server
```

## Architecture

- **MCP Server** (`src/index.ts`): Handles tool/resource requests from AI assistants
- **FoundryVTT Client** (`src/foundry/client.ts`): Communicates with FoundryVTT via REST API or WebSocket
- **Tools**: Dice rolling, actor/item searches, NPC generation
- **Resources**: Read-only access to world data

## Environment Variables

```bash
FOUNDRY_URL=http://localhost:30000  # FoundryVTT server URL
FOUNDRY_API_KEY=your_api_key       # API authentication (preferred)
# OR
FOUNDRY_USERNAME=username          # Username authentication
FOUNDRY_PASSWORD=password          # Password authentication
```

## Testing

- **Unit Tests**: `npm test` (Vitest)
- **E2E Tests**: `npm run test:e2e` (Playwright, headless by default)
- **Issue #7 Tests**: `npm run test:issue-7` (JSON parsing error reproduction)

## Key Notes

- Uses ES modules with `.js` imports (MCP SDK requirement)
- WebSocket fallback when REST API module unavailable
- Playwright tests run headless by default (use `test:e2e:headed` for visual debugging)