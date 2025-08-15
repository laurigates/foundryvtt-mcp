import { beforeAll, afterAll } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

let foundryContainer: StartedTestContainer | null = null;

beforeAll(async () => {
  console.log('Starting FoundryVTT container for integration tests...');
  
  try {
    foundryContainer = await new GenericContainer('felddy/foundryvtt:release')
      .withExposedPorts(30000)
      .withEnvironment({
        FOUNDRY_HOSTNAME: '0.0.0.0',
        FOUNDRY_LOCAL_HOSTNAME: 'localhost',
        FOUNDRY_ADMIN_KEY: process.env.FOUNDRY_ADMIN_KEY || 'test-admin-key-123',
        FOUNDRY_USERNAME: process.env.FOUNDRY_USERNAME || '',
        FOUNDRY_PASSWORD: process.env.FOUNDRY_PASSWORD || '',
        FOUNDRY_LICENSE_KEY: process.env.FOUNDRY_LICENSE_KEY || '',
        FOUNDRY_LOG_LEVEL: 'warn',
        CONTAINER_VERBOSE: 'false',
      })
      .withWaitStrategy(Wait.forHttp('/', 30000).forStatusCode(200))
      .withStartupTimeout(120000) // 2 minutes for FoundryVTT to start
      .start();

    const foundryUrl = `http://${foundryContainer.getHost()}:${foundryContainer.getMappedPort(30000)}`;
    process.env.FOUNDRY_URL = foundryUrl;
    
    console.log(`FoundryVTT container started at: ${foundryUrl}`);
  } catch (error) {
    console.error('Failed to start FoundryVTT container:', error);
    throw error;
  }
}, 180000); // 3 minutes timeout for beforeAll

afterAll(async () => {
  if (foundryContainer) {
    console.log('Stopping FoundryVTT container...');
    await foundryContainer.stop();
    foundryContainer = null;
  }
}, 30000); // 30 seconds timeout for cleanup