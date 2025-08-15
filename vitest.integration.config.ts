import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

export default defineConfig({
  test: {
    name: 'integration',
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: [
      'tests/e2e/**/*',
      'src/**/*.test.ts',
      'node_modules/**/*'
    ],
    testTimeout: 30000, // 30 seconds for integration tests
    hookTimeout: 60000, // 1 minute for setup/teardown
    env: {
      NODE_ENV: 'test',
      FOUNDRY_URL: process.env.FOUNDRY_TEST_URL || 'http://localhost:30001',
      FOUNDRY_ADMIN_KEY: process.env.FOUNDRY_ADMIN_KEY || 'test-admin-key-123',
      LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
    },
    setupFiles: ['./tests/integration/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/types/**/*',
        'tests/**/*',
      ],
    },
    // Run integration tests sequentially to avoid container conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
});