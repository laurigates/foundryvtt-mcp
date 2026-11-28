import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TargetConfig } from '../config/targets.js';
import type { ActorSearchResult } from '../foundry/types.js';
import type { FoundryProvider, ProviderConfig } from '../providers/types.js';

/** Exercise the script through real sessions while replacing only provider I/O. */
const harness = vi.hoisted(() => ({
  targets: [] as TargetConfig[],
  createProvider: vi.fn(),
}));

vi.mock('../providers/factory.js', () => ({ createProvider: harness.createProvider }));
vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../config/index.js', () => ({
  config: {
    logLevel: 'error',
    get targets() {
      return harness.targets;
    },
  },
}));

function target(id: string, provider: ProviderConfig): TargetConfig {
  return {
    id,
    provider,
    writeEnabled: false,
    integrationsEnabled: false,
  };
}

function providerFixture(id: string, count: number, offline = false) {
  let connected = false;
  let generation = 0;
  const actors: ActorSearchResult = {
    actors: Array.from({ length: count }, (_, index) => ({
      _id: `${id}-${index}`,
      name: `${id} Actor ${index}`,
      type: 'character',
    })),
    total: count,
    page: 1,
    limit: 3,
  };
  const provider = {
    kind: 'socketio',
    capabilities: new Set(['core.read']),
    connect: vi.fn(async () => {
      if (offline) {
        throw new Error('Fixture target is offline');
      }
      connected = true;
      generation++;
    }),
    disconnect: vi.fn(async () => {
      connected = false;
      generation++;
    }),
    isConnected: () => connected,
    getGeneration: () => generation,
    inspect: async () => ({
      world: { id, title: id },
      system: { id: 'dnd5e', version: 'fixture' },
      foundryVersion: 'fixture',
      modules: [],
      ready: true,
    }),
    searchActors: vi.fn(async () => actors),
  } as FoundryProvider;
  return provider;
}

describe('scripts/test-connection.ts', () => {
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    previousExitCode = process.exitCode;
    harness.targets = [];
    harness.createProvider.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  });

  it('passes every target provider configuration intact, reads ActorSearchResult, and closes all providers', async () => {
    const socket = target('alpha', {
      kind: 'socketio',
      baseUrl: 'https://host.example/foundry',
      username: 'gm',
      password: 'fixture-secret',
      socketPath: '/foundry/socket.io/',
      timeout: 10000,
    });
    const relay = target('beta', {
      kind: 'rest-api',
      relayUrl: 'https://relay.example',
      apiKey: 'fixture-key',
      clientId: 'paired-beta',
      executeJsPath: '/execute-js',
      timeout: 5000,
    });
    const first = providerFixture('alpha', 2);
    const second = providerFixture('beta', 1);
    harness.targets = [socket, relay];
    harness.createProvider.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { testConnection } = await import('../../scripts/test-connection.js');
    expect(harness.createProvider).not.toHaveBeenCalled();

    await testConnection();

    expect(harness.createProvider).toHaveBeenNthCalledWith(1, socket.provider);
    expect(harness.createProvider).toHaveBeenNthCalledWith(2, relay.provider);
    expect(harness.createProvider.mock.calls[0]?.[0]).toMatchObject({
      socketPath: '/foundry/socket.io/',
    });
    expect(first.searchActors).toHaveBeenCalledWith({ limit: 3 });
    expect(second.searchActors).toHaveBeenCalledWith({ limit: 3 });
    expect(console.log).toHaveBeenCalledWith('Actor read succeeded: 2 result(s)');
    expect(console.log).toHaveBeenCalledWith('Actor read succeeded: 1 result(s)');
    expect(console.log).toHaveBeenCalledWith('Checked 2 target(s); 0 connection/read failure(s).');
    expect(process.exitCode).toBe(0);
    for (const provider of [first, second]) {
      expect(provider.disconnect).toHaveBeenCalled();
      expect(provider.isConnected()).toBe(false);
    }
  });

  it('continues after one target fails and still closes every provider', async () => {
    harness.targets = [
      target('offline', { kind: 'socketio', baseUrl: 'https://offline.example' }),
      target('online', { kind: 'socketio', baseUrl: 'https://online.example' }),
    ];
    const offline = providerFixture('offline', 0, true);
    const online = providerFixture('online', 1);
    harness.createProvider.mockReturnValueOnce(offline).mockReturnValueOnce(online);
    const { testConnection } = await import('../../scripts/test-connection.js');

    await testConnection();

    expect(offline.searchActors).not.toHaveBeenCalled();
    expect(online.searchActors).toHaveBeenCalledWith({ limit: 3 });
    expect(console.log).toHaveBeenCalledWith('Checked 2 target(s); 1 connection/read failure(s).');
    expect(process.exitCode).toBe(1);
    for (const provider of [offline, online]) {
      expect(provider.disconnect).toHaveBeenCalled();
      expect(provider.isConnected()).toBe(false);
    }
  });
});
