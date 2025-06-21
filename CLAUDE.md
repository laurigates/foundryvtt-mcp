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
- Mocked external dependencies in test environment
- Test coverage reporting with V8

## Key Environment Variables

Required:
- `FOUNDRY_URL` - FoundryVTT server URL (e.g., http://localhost:30000)
- `FOUNDRY_API_KEY` OR `FOUNDRY_USERNAME`/`FOUNDRY_PASSWORD`

Optional:
- `USE_REST_MODULE=true` - Enable REST API module features
- `LOG_LEVEL=debug` - Detailed logging output
- `FOUNDRY_TIMEOUT=10000` - Request timeout in milliseconds

## Development Notes

- Uses ES modules with `.js` imports (required for MCP SDK compatibility)
- Strict TypeScript configuration with comprehensive type checking
- ESLint rules enforce functional programming patterns
- WebSocket fallback when REST API module unavailable
- Graceful degradation for missing FoundryVTT features
