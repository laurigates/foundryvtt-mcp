import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../errors.js';
import { ProviderOperationContext, withOperationContext } from '../operation-context.js';
import { RestApiProvider } from '../rest-api.js';

const actorId = 'actor00000000001';
const itemId = 'item000000000001';

function snapshot(name: string) {
  return {
    userId: 'user-a',
    world: { id: 'world-a', title: 'A' },
    system: { id: 'dnd5e', version: 'test' },
    release: { version: 'test' },
    modules: [],
    actors: [{ _id: actorId, name, items: [{ _id: itemId, name }] }],
    items: [],
    scenes: [],
    journal: [],
    messages: [],
    combats: [],
    users: [],
    activeUsers: [],
    macros: [],
    playlists: [],
    tables: [],
    folders: [],
    cards: [],
    packs: [],
    settings: [],
    demoMode: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function provider() {
  const instance = new RestApiProvider({
    kind: 'rest-api',
    relayUrl: 'http://relay.test',
    apiKey: 'test-key',
    clientId: 'test-client',
    writeEnabled: true,
  });
  Reflect.set(instance, '_isConnected', true);
  Reflect.set(instance, 'worldData', snapshot('original'));
  return instance;
}

describe('Relay operation context', () => {
  it('rejects an expired automatic refresh before it can overwrite the newer snapshot', async () => {
    const instance = provider();
    const response = deferred<unknown>();
    Reflect.set(instance, 'request', vi.fn(() => response.promise));
    const context = new ProviderOperationContext(() => {});
    const pending = withOperationContext(context, () => instance.refreshWorldData());
    const rejected = expect(pending).rejects.toMatchObject({ code: 'session_changed' });
    const newer = snapshot('newer');
    Reflect.set(instance, 'worldData', newer);
    context.finish();
    response.resolve({ snapshot: snapshot('late'), origin: 'https://world.test', ready: true });
    await rejected;
    expect(instance.getWorldData()).toBe(newer);
    await instance.disconnect();
  });

  it('does not apply a mutation acknowledgement after its session context expires', async () => {
    const instance = provider();
    const response = deferred<unknown>();
    vi.spyOn(instance, 'execute').mockImplementation(() => response.promise);
    const context = new ProviderOperationContext(() => {});
    const pending = withOperationContext(context, () => instance.deleteActorItem(actorId, itemId));
    const rejected = expect(pending).rejects.toMatchObject({ code: 'outcome_unknown' });
    const newer = snapshot('newer');
    Reflect.set(instance, 'worldData', newer);
    context.finish();
    response.resolve([itemId]);
    await rejected;
    expect(newer.actors[0]?.items).toHaveLength(1);
    await instance.disconnect();
  });

  it('leaves a concurrently refreshed snapshot untouched for direct provider consumers', async () => {
    const instance = provider();
    const response = deferred<unknown>();
    vi.spyOn(instance, 'execute').mockImplementation(() => response.promise);
    const pending = instance.deleteActorItem(actorId, itemId);
    const newer = snapshot('newer');
    Reflect.set(instance, 'worldData', newer);
    response.resolve([itemId]);
    await pending;
    expect(newer.actors[0]?.items).toHaveLength(1);
    await instance.disconnect();
  });

  it('rejects a mutation result belonging to a replaced provider generation', async () => {
    const instance = provider();
    const response = deferred<unknown>();
    vi.spyOn(instance, 'execute').mockImplementation(() => response.promise);
    const pending = instance.deleteActorItem(actorId, itemId);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'outcome_unknown' });
    Reflect.set(instance, 'generation', instance.getGeneration() + 1);
    const newer = snapshot('newer');
    Reflect.set(instance, 'worldData', newer);
    response.resolve([itemId]);
    await rejected;
    expect(newer.actors[0]?.items).toHaveLength(1);
    await instance.disconnect();
  });

  it('does not clear a replacement connection when an older connect fails late', async () => {
    const instance = provider();
    const firstSnapshot = deferred<void>();
    const newer = snapshot('newer');
    Reflect.set(
      instance,
      'readSnapshot',
      vi.fn()
        .mockImplementationOnce(async () => {
          await firstSnapshot.promise;
          throw new ProviderError('session_changed', 'Old connection');
        })
        .mockImplementationOnce(async () => {
          Reflect.set(instance, 'worldData', newer);
        }),
    );
    const first = instance.connect();
    const rejected = expect(first).rejects.toMatchObject({ code: 'session_changed' });
    await instance.connect();
    firstSnapshot.resolve();
    await rejected;
    expect(instance.isConnected()).toBe(true);
    expect(instance.getWorldData()).toBe(newer);
    await instance.disconnect();
  });
});
