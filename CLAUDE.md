# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development Workflow
- `npm run build` - Compile TypeScript to JavaScript in dist/
- `npm run dev` - Run server in development mode with hot reload
- `npm start` - Run production server from dist/
- `npm test` - Run test suite with Vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Generate test coverage report
- `npm run lint` - Lint TypeScript code with ESLint
- `npm run test-connection` - Test connection to FoundryVTT server

### Testing Commands
- `fvtt launch` - Start FoundryVTT server for testing
- `npm run test:e2e` - Run end-to-end tests with Playwright
- `npm run test:e2e:ui` - Run tests in Playwright UI mode
- `npm run test:e2e:headed` - Run tests in headed browser mode
- `npm run test:e2e:debug` - Run tests in debug mode
- `npm run test:e2e:report` - View Playwright test results
- `tsx scripts/run-e2e-tests.ts` - Run E2E tests with server checks

### Documentation
- `npm run docs` - Generate TypeDoc documentation
- `npm run docs:serve` - Generate and serve docs locally

### Setup and Maintenance
- `npm run setup` - Clean build and test connection
- `npm run clean` - Remove dist/ directory

## Architecture Overview

This is a **Model Context Protocol (MCP) server** that bridges AI assistants with FoundryVTT tabletop gaming software.

### Core Components

**Main Server (`src/index.ts`)**
- FoundryMCPServer class handles all MCP protocol communication
- Manages tool handlers for dice rolling, actor/item searches, NPC generation
- Provides resource endpoints for world data access
- Implements graceful shutdown and error handling

**FoundryVTT Client (`src/foundry/client.ts`)**
- Handles authentication via API key or username/password
- Supports both REST API module and WebSocket connections
- Implements retry logic and connection testing
- Provides typed interfaces for all FoundryVTT data

**Configuration System (`src/config/index.ts`)**
- Environment-based configuration with defaults
- Validation using Zod schemas
- Supports multiple authentication methods

**Type Definitions (`src/foundry/types.ts`)**
- Complete TypeScript interfaces for FoundryVTT entities
- Actor, Item, Scene, World, and DiceRoll types
- Search parameter and result types

### Data Flow
1. AI assistant calls MCP tool (e.g., `roll_dice`, `search_actors`)
2. Server validates parameters and routes to appropriate handler
3. Handler uses FoundryClient to communicate with FoundryVTT
4. Results are formatted and returned as MCP response
5. Resources provide read-only access to world state

### Authentication
- **Primary**: API key authentication with FoundryVTT REST API module
- **Fallback**: Username/password authentication
- Environment variables: `FOUNDRY_API_KEY` or `FOUNDRY_USERNAME`/`FOUNDRY_PASSWORD`

### Testing Strategy
- Unit tests for individual components
- Integration tests for FoundryVTT connectivity
- End-to-end testing with Playwright for UI validation
- Mocked external dependencies in test environment
- Test coverage reporting with V8

## Key Environment Variables

Required:
- `FOUNDRY_URL` - FoundryVTT server URL 
  - Local: `http://localhost:30000`
  - Reverse Proxy: `https://dnd.lakuz.com`
  - Network IP: `http://192.168.1.100:30000`
- `FOUNDRY_API_KEY` OR `FOUNDRY_USERNAME`/`FOUNDRY_PASSWORD`

Optional:
- `USE_REST_MODULE=true` - Enable REST API module features
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
- WebSocket fallback when REST API module unavailable
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

**Manual E2E Testing:**
```bash
# 1. Start FoundryVTT server
fvtt launch

# 2. Wait for server to be fully ready (usually 30-60 seconds)
# 3. Verify FoundryVTT is accessible at configured URL

# 4. Run Playwright tests
npm run test:e2e

# 5. Generate visual test reports
npm run test:e2e:report

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

### Development Testing Workflow
1. **Start FoundryVTT**: `fvtt launch`
2. **Run unit tests**: `npm test`
3. **Test MCP connection**: `npm run test-connection`
4. **Run E2E tests**: `npm run test:e2e` or `tsx scripts/run-e2e-tests.ts`
5. **Review test results**: `npm run test:e2e:report`

### Available Test Files
- `tests/e2e/rest-api-module.spec.ts` - Module visibility and functionality tests
- `tests/e2e/module-settings.spec.ts` - Comprehensive module settings validation
- `tests/e2e/helpers/foundry-helpers.ts` - Reusable test utilities for FoundryVTT

## Reference Links
- https://foundryvtt.com/api/
- https://playwright.dev/docs/intro