# Integration Tests

Real integration tests for the FoundryVTT MCP server using actual FoundryVTT instances.

## Overview

These integration tests use [testcontainers](https://node.testcontainers.org/) and the [felddy/foundryvtt-docker](https://github.com/felddy/foundryvtt-docker) container to run tests against real FoundryVTT instances instead of mocked responses.

## Key Benefits

✅ **Real API Testing**: Tests actual FoundryVTT API responses and data formats  
✅ **Contract Validation**: Ensures our mocks match reality  
✅ **Authentication Testing**: Real API key and WebSocket authentication flows  
✅ **Error Scenario Coverage**: Network failures, timeouts, and malformed responses  
✅ **Version Compatibility**: Can test against multiple FoundryVTT versions

## Setup

### 1. FoundryVTT Credentials

You need valid FoundryVTT credentials to download the software. Create a `.env.test` file:

```bash
cp .env.test.template .env.test
```

Then edit `.env.test` with your actual credentials:
```bash
FOUNDRY_USERNAME=your-foundry-username
FOUNDRY_PASSWORD=your-foundry-password
FOUNDRY_LICENSE_KEY=your-foundry-license-key
```

### 2. Docker Required

These tests require Docker to be running as they spin up FoundryVTT containers.

## Running Tests

### Local Testing with TestContainers
```bash
# Run integration tests (starts containers automatically)
npm run test:integration

# Watch mode
npm run test:integration:watch

# With UI
npm run test:integration:ui
```

### Local Testing with Docker Compose
```bash
# Run with pre-defined docker-compose setup
npm run test:integration:docker
```

### Manual Container Management
```bash
# Start FoundryVTT container
docker-compose -f docker-compose.test.yml up -d

# Run tests against running container
FOUNDRY_URL=http://localhost:30001 npm run test:integration

# Stop container
docker-compose -f docker-compose.test.yml down
```

## Test Structure

### Real vs Mock Tests
- `tests/integration/` - **Real FoundryVTT integration tests**
- `src/**/*.test.ts` - Unit tests with mocks (fast, isolated)
- `tests/e2e/` - End-to-end browser tests

### Test Categories
- **Connection Tests**: Real authentication and connection lifecycle
- **API Operation Tests**: Actual FoundryVTT API calls and responses
- **Error Scenario Tests**: Network failures, timeouts, invalid data
- **Contract Tests**: Validate API response schemas match expectations
- **WebSocket Tests**: Real WebSocket communication

## GitHub Actions CI/CD

The integration tests run in GitHub Actions using the same Docker approach:

```yaml
services:
  foundryvtt:
    image: felddy/foundryvtt:release
    # ... configured with secrets
```

### Required GitHub Secrets
- `FOUNDRY_USERNAME` - Your FoundryVTT username
- `FOUNDRY_PASSWORD` - Your FoundryVTT password  
- `FOUNDRY_LICENSE_KEY` - Your FoundryVTT license key

### Security
- Fork PRs require manual approval via `requires-approval` environment
- Secrets are only accessible after approval
- Tests run in isolated containers

## Troubleshooting

### Container Start Issues
```bash
# Check container logs
docker-compose -f docker-compose.test.yml logs foundryvtt

# Verify credentials
echo $FOUNDRY_USERNAME
```

### Test Timeouts
Integration tests have longer timeouts (30s) due to:
- Container startup time
- FoundryVTT initialization  
- Real network operations

### License Issues
- Ensure you have a valid FoundryVTT license
- Check that credentials are correct in `.env.test`
- Verify license allows automated usage

## Adding New Tests

1. Create test file in `tests/integration/`
2. Import real FoundryClient (not mocked)
3. Use real assertions about actual API responses
4. Add appropriate timeouts for network operations

Example:
```typescript
import { FoundryClient } from '../../src/foundry/client.js';

describe('New Integration Test', () => {
  let client: FoundryClient;

  beforeEach(() => {
    client = new FoundryClient({
      baseUrl: process.env.FOUNDRY_URL,
      apiKey: process.env.FOUNDRY_ADMIN_KEY,
    });
  });

  it('should test real behavior', async () => {
    await client.connect();
    const result = await client.someRealMethod();
    
    // Assert against real response structure
    expect(result).toMatchObject({
      realField: expect.any(String),
    });
  }, 30000); // 30s timeout for real operations
});
```

## Performance Considerations

- Tests run sequentially to avoid container conflicts
- Container startup adds ~30-60s overhead
- Consider test batching for efficiency
- Use `singleFork: true` in Vitest config for isolation