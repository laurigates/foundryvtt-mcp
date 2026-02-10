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

**FoundryVTT Client (`src/foundry/client.ts`)**
- Authenticates via Socket.IO 4-step flow (fetch /join page, extract session cookie, resolve user ID, emit joinGame)
- Loads complete world state (actors, items, scenes, journals, combats, users) into memory on connect
- All query tools filter from this cached worldData
- Provides typed interfaces for all FoundryVTT data

**Socket.IO Authentication (`src/foundry/auth.ts`)**
- Implements the 4-step Socket.IO authentication sequence
- Handles session cookie extraction and user ID resolution
- Supports direct `FOUNDRY_USER_ID` bypass for the resolution step

**Configuration System (`src/config/index.ts`)**
- Environment-based configuration with defaults
- Validation using Zod schemas
- Username/password as primary authentication method

**Tool System (`src/tools/`)**
- `definitions.ts` - Tool schemas organized by category (data access, game mechanics, content generation, diagnostics)
- `router.ts` - Routes MCP tool requests to appropriate handlers
- `resources.ts` - MCP resource definitions (foundry:// URIs)
- `handlers/` - Per-tool handler implementations (actors, items, scenes, journals, combat, chat, users, world, dice, generation, diagnostics)

**Type Definitions (`src/foundry/types.ts`)**
- Complete TypeScript interfaces for FoundryVTT entities
- WorldData type representing the full cached game state
- Actor, Item, Scene, Journal, Combat, User types

### Data Flow
1. AI assistant calls MCP tool (e.g., `search_actors`, `get_combat_state`)
2. Server validates parameters and routes to handler via `router.ts`
3. Handler filters worldData (loaded on connect) for matching results
4. Results formatted and returned as MCP response
5. Resources provide read-only access to world state via `foundry://` URIs

### Authentication
- **Primary**: Socket.IO with username/password (full game data access)
- **Optional**: API key for REST API module diagnostics (server logs, health metrics)
- Environment variables: `FOUNDRY_USERNAME`/`FOUNDRY_PASSWORD` (required), `FOUNDRY_API_KEY` (optional)

- **Unit Tests**: `npm test` (Vitest)
- **E2E Tests**: `npm run test:e2e` (Playwright, headless by default)
- **Issue #7 Tests**: `npm run test:issue-7` (JSON parsing error reproduction)

## Key Notes

## Key Environment Variables

Required:
- `FOUNDRY_URL` - FoundryVTT server URL
  - Local: `http://localhost:30000`
  - Reverse Proxy: `https://dnd.lakuz.com`
  - Network IP: `http://192.168.1.100:30000`
- `FOUNDRY_USERNAME` / `FOUNDRY_PASSWORD` - FoundryVTT user credentials

Optional:
- `FOUNDRY_USER_ID` - 16-character document `_id` to bypass username-to-ID resolution
- `FOUNDRY_API_KEY` - REST API module key (enables 5 diagnostics tools)
- `LOG_LEVEL=debug` - Detailed logging output
- `FOUNDRY_TIMEOUT=10000` - Request timeout in milliseconds

## Setup Types

The setup wizard now properly handles different deployment scenarios:
- **Local Development**: Auto-detects localhost:30000 and similar
- **Reverse Proxy/Remote**: Prompts for custom URLs like https://dnd.lakuz.com
- **Network/IP**: Supports custom IP addresses and ports

## Development Notes

- Uses ES modules with `.js` imports (required for MCP SDK compatibility)
- Strict TypeScript configuration with comprehensive type checking
- ESLint rules enforce functional programming patterns
- Socket.IO is the primary connection method for all game data access
- REST API module optional — only adds 5 server diagnostics tools
- Graceful degradation for missing FoundryVTT features

## Testing Procedures

### Unit and Integration Tests
```bash
# Run all tests with coverage
npm test

# Run tests in watch mode during development
npm run test:watch

# Generate coverage report
npm run test:coverage

# Test MCP server connection to FoundryVTT
npm run test-connection
```

### End-to-End Testing with Playwright

**Prerequisites:**
- FoundryVTT installed and accessible
- Browser automation tools available
- Test world/data configured

**E2E Testing (Headless by Default):**
```bash
# Run tests in headless mode (no browser windows open)
npm run test:e2e

# Run with visible browser for debugging
npm run test:e2e:headed

# Interactive test runner with UI
npm run test:e2e:ui

# Debug mode with breakpoints
npm run test:e2e:debug

# Generate and view test reports
npm run test:e2e:report
```

**Manual E2E Setup (if needed):**
```bash
# 1. Start FoundryVTT server manually
fvtt launch

# 2. Wait for server to be fully ready (usually 30-60 seconds)
# 3. Verify FoundryVTT is accessible at configured URL

# 4. Run tests (auto-starts server by default)
npm run test:e2e

# Alternative: Use test runner script (includes server checks)
tsx scripts/run-e2e-tests.ts
```

**Automated E2E Pipeline:**
For CI/CD integration, tests should include:
1. **Pre-test setup**: Automated FoundryVTT server startup with `fvtt launch`
2. **Health check**: Wait for server readiness before test execution
3. **Test execution**: Playwright tests against live FoundryVTT instance
4. **Cleanup**: Graceful server shutdown and resource cleanup

**Test Categories:**
- **Module Visibility**: Verify REST API module appears in module management
- **Module Settings**: Validate module configuration options are accessible
- **API Endpoints**: Test REST API endpoint accessibility and responses
- **Authentication**: Validate login flows and API key usage
- **Module Installation**: Verify module files and manifest are properly installed
- **Issue-Specific Testing**: Targeted tests for known issues and bug reproduction

**Test Data Requirements:**
- Test world with sample actors, items, and scenes
- Configured user accounts with appropriate permissions
- Mock data for consistent test results

### Performance Testing
```bash
# Load testing for concurrent MCP connections
npm run test:load

# Memory usage profiling
npm run test:memory

# Response time benchmarking
npm run test:benchmark
```

### Browser Modes for E2E Testing

**Headless Mode (Default):**
- Fastest execution, no visual distractions
- Perfect for CI/CD pipelines and automated testing
- Use for regular development and verification

**Headed Mode (Visual):**
- Opens actual browser windows to see test execution
- Useful for debugging failing tests or understanding test flow
- Use when developing new tests or investigating issues

**Interactive Mode (UI):**
- Playwright's test runner interface with step-by-step control
- Best for developing and debugging complex test scenarios
- Allows pausing, stepping through, and inspecting test state

**Debug Mode:**
- Opens browser with developer tools and breakpoints
- Enables step-by-step debugging with Playwright inspector
- Essential for diagnosing complex test failures

### Development Testing Workflow
1. **Start FoundryVTT**: `fvtt launch` (optional - auto-started by tests)
2. **Run unit tests**: `npm test`
3. **Test MCP connection**: `npm run test-connection`
4. **Run E2E tests**: `npm run test:e2e` (headless by default)
5. **Debug if needed**: `npm run test:e2e:headed` or `npm run test:e2e:debug`
6. **Review test results**: `npm run test:e2e:report`

### Issue-Specific Testing

**Issue #7 - JSON Parsing Errors:**
```bash
# Test for JSON parsing errors specifically
npm run test:issue-7

# Run with visible browser for debugging
npm run test:issue-7:headed

# Using Makefile
make test-issue-7
make test-issue-7-headed
```

This test specifically targets the malformed JSON error reported in GitHub issue #7:
- Tests all REST API endpoints for JSON parsing errors
- Validates array response formats
- Checks for malformation patterns like missing commas, extra commas, unclosed objects
- Monitors console errors related to REST API
- Tests timing issues during module initialization

### Available Test Files
- `tests/e2e/rest-api-module.spec.ts` - Module visibility and functionality tests
- `tests/e2e/module-settings.spec.ts` - Comprehensive module settings validation
- `tests/e2e/issue-7-json-parsing.spec.ts` - Issue #7 JSON parsing error reproduction
- `tests/e2e/helpers/foundry-helpers.ts` - Reusable test utilities for FoundryVTT

## Reference Links
- https://foundryvtt.com/api/
- https://playwright.dev/docs/intro
