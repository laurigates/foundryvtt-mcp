import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      FOUNDRY_URL: 'http://localhost:30000',
      LOG_LEVEL: 'error', // Reduce log noise in tests
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/types/**/*'],
      // A floor about two points under the 2026-11-25 measurement
      // (statements 74.5, branches 67.8, functions 76.6, lines 74.8):
      // it catches a drop without failing on noise. Raise it as coverage grows.
      thresholds: {
        statements: 72,
        branches: 65,
        functions: 74,
        lines: 72,
      },
    },
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
});
