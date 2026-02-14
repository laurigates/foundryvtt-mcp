# Testing Requirements

## Unit Tests (Vitest)

- All new functions require corresponding unit tests
- Run with `npm test` or `npm run test:watch`
- Coverage reports via `npm run test:coverage`

## E2E Tests (Playwright)

- Test against live FoundryVTT instance
- Default headless mode: `npm run test:e2e`
- Debug mode: `npm run test:e2e:debug`

## Test Categories

- Module visibility and functionality
- REST API endpoint accessibility
- Authentication flows
- Socket.IO connection handling
