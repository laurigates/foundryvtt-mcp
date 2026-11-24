import { configDefaults, defineConfig } from 'vitest/config';

/**
 * The live parity spec is its own project: it reads the shell's FOUNDRY_URL
 * (the harness on :30000), skips itself unless the whole parity environment is
 * set, and needs no global setup. The other specs wait for the test container
 * on :30001 in global-setup.ts, which Vitest runs only for a project with
 * selected files. So
 *
 *   FOUNDRY_URL=http://localhost:30000 bun run test:integration tests/integration/parity.integration.test.ts
 *
 * skips at once when no Foundry is up, instead of polling for 120 s and failing.
 */
const PARITY_SPEC = 'tests/integration/parity.integration.test.ts';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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
      LOG_LEVEL: 'error',
    },
    // Inline projects inherit the options above (`extends` defaults to true
    // since Vitest 5); a root-level globalSetup would run for every project.
    projects: [
      {
        test: {
          name: 'live',
          include: ['tests/integration/**/*.test.ts'],
          exclude: [...configDefaults.exclude, PARITY_SPEC],
          env: { FOUNDRY_URL: 'http://localhost:30001' },
          globalSetup: ['tests/integration/global-setup.ts'],
        },
      },
      {
        test: {
          name: 'parity',
          include: [PARITY_SPEC],
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
});
