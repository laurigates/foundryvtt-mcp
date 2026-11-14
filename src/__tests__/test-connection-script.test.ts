import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `scripts/` is outside the tsc surface (see .claude/rules/scripts-typecheck-gap.md),
 * so this test is the only build-time check on how `bun run test-connection`
 * constructs its FoundryClient.
 */

const constructed: unknown[] = [];

vi.mock('../foundry/client.js', () => ({
  FoundryClient: class {
    constructor(config: unknown) {
      constructed.push(config);
    }
    // Report failure so the script stops right after constructing the client.
    testConnection = vi.fn().mockResolvedValue(false);
  },
}));
vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../config/index.js', () => ({
  config: {
    logLevel: 'error',
    foundry: {
      url: 'https://host.example/foundry',
      username: 'gm',
      password: 'secret',
      socketPath: '/foundry/socket.io/',
      timeout: 10000,
    },
  },
}));

describe('scripts/test-connection.ts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    constructed.length = 0;
  });

  it('passes FOUNDRY_SOCKET_PATH to the FoundryClient it builds (#231)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { testConnection } = await import('../../scripts/test-connection.js');

    await testConnection();

    expect(constructed).toHaveLength(1);
    expect(constructed[0]).toMatchObject({
      baseUrl: 'https://host.example/foundry',
      socketPath: '/foundry/socket.io/',
    });
  });
});
