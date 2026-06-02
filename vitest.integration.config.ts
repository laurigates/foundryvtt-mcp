import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
    pool: 'forks',
    // Vitest 4 removed test.poolOptions; the previous
    // poolOptions.forks.singleFork is now maxWorkers + isolate (run the
    // integration suite serially in one process against the single shared
    // FoundryVTT instance). See https://vitest.dev/guide/migration#pool-rework
    maxWorkers: 1,
    isolate: false,
    env: {
      NODE_ENV: 'test',
      FOUNDRY_URL: 'http://localhost:30001',
      LOG_LEVEL: 'error',
    },
    globalSetup: ['tests/integration/global-setup.ts'],
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
});
