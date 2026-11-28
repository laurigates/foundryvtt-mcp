import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TargetConfig } from '../../config/targets.js';
import type { FoundryEnvironment, FoundryProvider } from '../../providers/types.js';
import { FoundrySessionManager, type SessionIntegrations } from '../index.js';

function environment(worldId: string): FoundryEnvironment {
  return {
    world: { id: worldId, title: worldId },
    system: { id: 'dnd5e', version: '1' },
    foundryVersion: '14',
    modules: [],
    ready: true,
  };
}

function fakeProvider(worldId: string, fail = false) {
  let connected = false;
  let generation = 0;
  let env = environment(worldId);
  const provider = {
    kind: 'socketio',
    capabilities: new Set(['core.read', 'core.write', 'core.cache']),
    connect: vi.fn(async () => {
      if (fail) {
        throw new Error('connection failed');
      }
      connected = true;
      generation++;
    }),
    disconnect: vi.fn(async () => {
      connected = false;
      generation++;
    }),
    inspect: vi.fn(async () => env),
    isConnected: () => connected,
    getGeneration: () => generation,
    isWorldDataStale: () => false,
    refreshWorldData: vi.fn(async () => {}),
    getActor: vi.fn(async (id: string) => ({ _id: id, name: worldId, type: 'character' })),
    execute: vi.fn(async () => ({ from: worldId })),
  } as FoundryProvider;
  return {
    provider,
    drop() {
      connected = false;
      generation++;
    },
    restore() {
      connected = true;
      generation++;
    },
    changeWorld(world: string) {
      env = environment(world);
      generation++;
    },
  };
}

function integrationStub(): SessionIntegrations {
  return {
    reconcile: vi.fn(async () => {}),
    getTools: () => [],
    list: () => [],
    has: () => false,
    call: vi.fn(async () => null),
    close: vi.fn(async () => {}),
  };
}

function target(id: string, writeEnabled = false): TargetConfig {
  return {
    id,
    provider: { kind: 'socketio', baseUrl: `http://${id}.test`, writeEnabled },
    writeEnabled,
    integrationsEnabled: true,
  };
}

const managers: FoundrySessionManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
  vi.useRealTimers();
});

describe('FoundrySessionManager', () => {
  it('routes identical document IDs through independent providers', async () => {
    const a = fakeProvider('world-a');
    const b = fakeProvider('world-b');
    const manager = new FoundrySessionManager([target('a'), target('b')], {
      providerFactory: (config) =>
        config.kind === 'socketio' && config.baseUrl.includes('a.test') ? a.provider : b.provider,
      integrationFactory: integrationStub,
      monitorIntervalMs: 0,
    });
    managers.push(manager);
    await manager.start();
    expect(
      await manager.resolve('a').run((provider) => provider.getActor('shared-id')),
    ).toMatchObject({ name: 'world-a' });
    expect(
      await manager.resolve('b').run((provider) => provider.getActor('shared-id')),
    ).toMatchObject({ name: 'world-b' });
    expect(manager.list().map((status) => status.state)).toEqual(['ready', 'ready']);
  });

  it('does not retarget omitted calls when another configured world is offline', async () => {
    const a = fakeProvider('a');
    const b = fakeProvider('b', true);
    const manager = new FoundrySessionManager([target('a'), target('b')], {
      providerFactory: (config) =>
        config.kind === 'socketio' && config.baseUrl.includes('a.test') ? a.provider : b.provider,
      integrationFactory: integrationStub,
      monitorIntervalMs: 0,
    });
    managers.push(manager);
    await expect(manager.start()).resolves.toBeUndefined();
    expect(manager.resolve('a').state).toBe('ready');
    expect(manager.resolve('b').state).toBe('error');
    expect(() => manager.resolve()).toThrow(/target_id is required/);
    expect(() => manager.resolve('missing')).toThrow(/Unknown target/);
  });

  it('supports the single configured target without a mutable current-world setting', async () => {
    const fake = fakeProvider('only');
    const manager = new FoundrySessionManager([target('only')], {
      providerFactory: () => fake.provider,
      integrationFactory: integrationStub,
      monitorIntervalMs: 0,
    });
    managers.push(manager);
    await manager.start();
    expect(manager.resolve().config.id).toBe('only');
  });

  it('enforces each target write policy before invoking a provider', async () => {
    const a = fakeProvider('a');
    const b = fakeProvider('b');
    const manager = new FoundrySessionManager([target('a', true), target('b')], {
      providerFactory: (config) =>
        config.kind === 'socketio' && config.baseUrl.includes('a.test') ? a.provider : b.provider,
      integrationFactory: integrationStub,
      monitorIntervalMs: 0,
    });
    managers.push(manager);
    await manager.start();
    const mutation = vi.fn(async () => 'applied');
    expect(await manager.resolve('a').run(mutation, { write: true })).toBe('applied');
    await expect(manager.resolve('b').run(mutation, { write: true })).rejects.toMatchObject({
      code: 'writes_disabled',
    });
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it('rejects late responses from a replaced transport and does not retry writes', async () => {
    const fake = fakeProvider('a');
    const manager = new FoundrySessionManager([target('a', true)], {
      providerFactory: () => fake.provider,
      integrationFactory: integrationStub,
      monitorIntervalMs: 0,
    });
    managers.push(manager);
    await manager.start();
    let release: (() => void) | undefined;
    const mutation = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = manager.resolve().run(mutation, { write: true });
    await Promise.resolve();
    fake.drop();
    fake.restore();
    release?.();
    await expect(pending).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(manager.resolve().state).toBe('offline');
  });

  it('pins remote identity and rejects a different world after reconnection', async () => {
    const fake = fakeProvider('world-a');
    const manager = new FoundrySessionManager([target('a')], {
      providerFactory: () => fake.provider,
      integrationFactory: integrationStub,
      monitorIntervalMs: 0,
    });
    managers.push(manager);
    await manager.start();
    fake.changeWorld('world-b');
    await expect(manager.refresh('a')).rejects.toMatchObject({ code: 'world_mismatch' });
    expect(manager.resolve().state).toBe('error');
    await expect(manager.resolve().run(async () => null)).rejects.toMatchObject({
      code: 'target_unavailable',
    });
  });

  it('recreates integration scope after reconnecting and closes only its own session', async () => {
    const a = fakeProvider('a');
    const b = fakeProvider('b');
    const integrationFactory = vi.fn(integrationStub);
    const manager = new FoundrySessionManager([target('a'), target('b')], {
      providerFactory: (config) =>
        config.kind === 'socketio' && config.baseUrl.includes('a.test') ? a.provider : b.provider,
      integrationFactory,
      monitorIntervalMs: 0,
    });
    managers.push(manager);
    await manager.start();
    const original = manager.resolve('a').integrations;
    const oldGeneration = manager.resolve('a').generation;
    await manager.reconnect('a');
    expect(manager.resolve('a').generation).toBeGreaterThan(oldGeneration);
    expect(manager.resolve('a').integrations).not.toBe(original);
    expect(original.close).toHaveBeenCalled();
    await manager.resolve('a').close();
    expect(manager.resolve('b').state).toBe('ready');
    expect(b.provider.disconnect).not.toHaveBeenCalled();
  });

  it('does not expose credentials in status output', async () => {
    const fake = fakeProvider('a');
    const config = target('a');
    config.provider = {
      kind: 'legacy-rest',
      baseUrl: 'https://foundry.test',
      apiKey: 'do-not-print',
    };
    const manager = new FoundrySessionManager([config], {
      providerFactory: () => fake.provider,
      integrationFactory: integrationStub,
      monitorIntervalMs: 0,
    });
    managers.push(manager);
    await manager.start();
    expect(JSON.stringify(manager.list())).not.toContain('do-not-print');
  });

  it('rejects pending core requests immediately when their session closes', async () => {
    const fake = fakeProvider('a');
    const manager = new FoundrySessionManager([target('a')], {
      providerFactory: () => fake.provider,
      integrationFactory: integrationStub,
      monitorIntervalMs: 0,
    });
    managers.push(manager);
    await manager.start();
    const pending = manager.resolve().run(() => new Promise<never>(() => {}));
    const rejected = expect(pending).rejects.toMatchObject({ code: 'session_changed' });
    await manager.close();
    await rejected;
  });

  it('reconciles restored transports without affecting other targets', async () => {
    vi.useFakeTimers();
    const fake = fakeProvider('a');
    const changed = vi.fn();
    const manager = new FoundrySessionManager([target('a')], {
      providerFactory: () => fake.provider,
      integrationFactory: integrationStub,
      monitorIntervalMs: 10,
      onChange: changed,
    });
    managers.push(manager);
    await manager.start();
    const previous = manager.resolve().integrations;
    fake.drop();
    await vi.advanceTimersByTimeAsync(10);
    expect(manager.resolve().state).toBe('offline');
    expect(previous.close).toHaveBeenCalled();
    fake.restore();
    await vi.advanceTimersByTimeAsync(10);
    expect(manager.resolve().state).toBe('ready');
    expect(manager.resolve().integrations).not.toBe(previous);
    expect(fake.provider.refreshWorldData).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalled();
  });

  it('keeps core operations available when optional integration loading fails', async () => {
    const fake = fakeProvider('a');
    const manager = new FoundrySessionManager([target('a')], {
      providerFactory: () => fake.provider,
      monitorIntervalMs: 0,
      integrationFactory: () => ({
        ...integrationStub(),
        reconcile: vi.fn(async () => {
          throw new Error('Integration probe failed');
        }),
      }),
    });
    managers.push(manager);
    await manager.start();
    expect(manager.resolve().state).toBe('ready');
    expect(manager.list()[0]?.integrationError).toBe('Integration probe failed');
    await expect(
      manager.resolve().run((provider) => provider.getActor('same')),
    ).resolves.toMatchObject({ name: 'a' });
  });

  it('keeps an identity mismatch latched until an explicit recovery request', async () => {
    vi.useFakeTimers();
    const fake = fakeProvider('expected');
    const manager = new FoundrySessionManager([target('a')], {
      providerFactory: () => fake.provider,
      integrationFactory: integrationStub,
      monitorIntervalMs: 10,
    });
    managers.push(manager);
    await manager.start();
    fake.changeWorld('unexpected');
    await vi.advanceTimersByTimeAsync(10);
    expect(manager.resolve().state).toBe('error');
    expect(fake.provider.refreshWorldData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.provider.refreshWorldData).toHaveBeenCalledTimes(1);
  });

  it('waits for a target write before refreshing its cache for a concurrent read', async () => {
    const fake = fakeProvider('a');
    let stale = false;
    let remoteName = 'before';
    let cachedName = 'before';
    let finishWrite: (() => void) | undefined;
    fake.provider.isWorldDataStale = () => stale;
    fake.provider.refreshWorldData = vi.fn(async () => {
      cachedName = remoteName;
      stale = false;
    });
    fake.provider.getActor = vi.fn(async (id) => ({
      _id: id,
      name: cachedName,
      type: 'character',
    }));
    const manager = new FoundrySessionManager([target('a', true)], {
      providerFactory: () => fake.provider,
      integrationFactory: integrationStub,
      monitorIntervalMs: 0,
    });
    managers.push(manager);
    await manager.start();
    const session = manager.resolve();
    const generation = session.generation;
    const integration = session.integrations;
    const write = session.run(
      async () => {
        stale = true;
        await new Promise<void>((resolve) => {
          finishWrite = resolve;
        });
        remoteName = 'after';
        stale = true;
        return 'applied';
      },
      { write: true },
    );
    const read = session.run((provider) => provider.getActor('same'), { refreshCache: true });
    await Promise.resolve();
    expect(fake.provider.refreshWorldData).not.toHaveBeenCalled();
    finishWrite?.();
    await expect(write).resolves.toBe('applied');
    await expect(read).resolves.toMatchObject({ name: 'after' });
    expect(fake.provider.refreshWorldData).toHaveBeenCalledTimes(1);
    expect(session.generation).toBe(generation);
    expect(session.integrations).toBe(integration);
  });

  it('cancels queued writes before dispatch when a target reconnects', async () => {
    const fake = fakeProvider('a');
    const manager = new FoundrySessionManager([target('a', true)], {
      providerFactory: () => fake.provider,
      integrationFactory: integrationStub,
      monitorIntervalMs: 0,
    });
    managers.push(manager);
    await manager.start();
    const session = manager.resolve();
    const first = session.run(() => new Promise<never>(() => {}), { write: true });
    const queuedOperation = vi.fn(async () => 'must not run');
    const queued = session.run(queuedOperation, { write: true });
    await Promise.resolve();
    const firstRejected = expect(first).rejects.toMatchObject({ code: 'outcome_unknown' });
    const queuedRejected = expect(queued).rejects.toMatchObject({ code: 'session_changed' });
    await session.reconnect();
    await Promise.all([firstRejected, queuedRejected]);
    expect(queuedOperation).not.toHaveBeenCalled();
    await expect(session.run(async () => 'new context')).resolves.toBe('new context');
  });

  it('skips snapshot refresh for providers without a world cache', async () => {
    const fake = fakeProvider('a');
    const config = target('a');
    config.provider = { kind: 'legacy-rest', baseUrl: 'http://a.test', apiKey: 'legacy-key' };
    const provider: FoundryProvider = {
      ...fake.provider,
      kind: 'legacy-rest',
      capabilities: new Set(['core.read']),
      isWorldDataStale: () => true,
    };
    const manager = new FoundrySessionManager([config], {
      providerFactory: () => provider,
      integrationFactory: integrationStub,
      monitorIntervalMs: 0,
    });
    managers.push(manager);
    await manager.start();
    await expect(
      manager.resolve().run((core) => core.getActor('same'), { refreshCache: true }),
    ).resolves.toMatchObject({ name: 'a' });
    expect(provider.refreshWorldData).not.toHaveBeenCalled();
  });

  it.each(['before', 'during'] as const)(
    'rejects a legacy REST world switch %s a read with no disconnect',
    async (phase) => {
      const fake = fakeProvider('world-a');
      const other = fakeProvider('world-b');
      let remoteWorld = 'world-a';
      const provider: FoundryProvider = {
        ...fake.provider,
        kind: 'legacy-rest',
        capabilities: new Set(['core.read']),
        inspect: vi.fn(async () => environment(remoteWorld)),
        getActor: vi.fn(async (id) => {
          if (phase === 'during') {
            remoteWorld = 'unexpected';
          }
          return { _id: id, name: `Actor in ${remoteWorld}`, type: 'character' };
        }),
      };
      const config = target('legacy');
      config.provider = {
        kind: 'legacy-rest',
        baseUrl: 'http://legacy.test',
        apiKey: 'legacy-key',
      };
      if (phase === 'before') {
        config.expectedWorldId = 'world-a';
      }
      const manager = new FoundrySessionManager([config, target('other')], {
        providerFactory: (entry) => (entry.kind === 'legacy-rest' ? provider : other.provider),
        integrationFactory: integrationStub,
        monitorIntervalMs: 0,
      });
      managers.push(manager);
      await manager.start();
      const session = manager.resolve('legacy');
      const generation = provider.getGeneration();
      if (phase === 'before') {
        remoteWorld = 'unexpected';
      }
      const result = session.run((core) => core.getActor('same'));
      const queued = session.run((core) => core.getActor('same'));
      await Promise.all([
        expect(result).rejects.toMatchObject({ code: 'world_mismatch' }),
        expect(queued).rejects.toMatchObject({ code: 'target_unavailable' }),
      ]);
      expect(provider.getGeneration()).toBe(generation);
      expect(provider.getActor).toHaveBeenCalledTimes(phase === 'before' ? 0 : 1);
      expect(session.state).toBe('error');
      expect(session.environment?.world.id).toBe('world-a');
      expect(session.status().error).toContain('expected world world-a');
      await expect(
        manager.resolve('other').run((core) => core.getActor('same')),
      ).resolves.toMatchObject({ name: 'world-b' });
    },
  );

  it('checks stable legacy REST identity without replacing its session', async () => {
    const fake = fakeProvider('world-a');
    const provider: FoundryProvider = {
      ...fake.provider,
      kind: 'legacy-rest',
      capabilities: new Set(['core.read']),
    };
    const config = target('legacy');
    config.provider = { kind: 'legacy-rest', baseUrl: 'http://legacy.test', apiKey: 'legacy-key' };
    const manager = new FoundrySessionManager([config], {
      providerFactory: () => provider,
      integrationFactory: integrationStub,
      monitorIntervalMs: 0,
    });
    managers.push(manager);
    await manager.start();
    const session = manager.resolve();
    const generation = session.generation;
    await expect(session.run((core) => core.getActor('same'))).resolves.toMatchObject({
      name: 'world-a',
    });
    expect(provider.inspect).toHaveBeenCalledTimes(3);
    expect(provider.getActor).toHaveBeenCalledTimes(1);
    expect(session.state).toBe('ready');
    expect(session.generation).toBe(generation);
    expect(provider.refreshWorldData).not.toHaveBeenCalled();
  });

  it('serializes operations per target without blocking other worlds', async () => {
    const a = fakeProvider('a');
    const b = fakeProvider('b');
    const manager = new FoundrySessionManager([target('a'), target('b')], {
      providerFactory: (config) =>
        config.kind === 'socketio' && config.baseUrl.includes('a.test') ? a.provider : b.provider,
      integrationFactory: integrationStub,
      monitorIntervalMs: 0,
    });
    managers.push(manager);
    await manager.start();
    const blocked = manager.resolve('a').run(() => new Promise<never>(() => {}));
    await expect(
      manager.resolve('b').run((provider) => provider.getActor('same')),
    ).resolves.toMatchObject({ name: 'b' });
    const rejected = expect(blocked).rejects.toMatchObject({ code: 'session_changed' });
    await manager.close();
    await rejected;
  });
});
