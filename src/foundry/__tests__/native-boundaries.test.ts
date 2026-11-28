import axios from 'axios';
import { io } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProviderOperationContext,
  withOperationContext,
} from '../../providers/operation-context.js';
import { SocketIOProvider } from '../../providers/socketio.js';
import { authenticateFoundry } from '../auth.js';
import type { WorldData } from '../types.js';

vi.mock('axios');
vi.mock('socket.io-client');
vi.mock('../auth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.js')>()),
  authenticateFoundry: vi.fn(),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const ACTOR_ID = 'aaaaaaaaaaaaaaaa';
const ITEM_ID = 'bbbbbbbbbbbbbbbb';
const COMBAT_ID = 'cccccccccccccccc';

function snapshot(): WorldData {
  return {
    world: { id: 'world-a', title: 'World A' },
    system: { id: 'dnd5e', version: '1' },
    release: { version: '13' },
    userId: 'user-a',
    demoMode: false,
    modules: [],
    actors: [],
    items: [],
    scenes: [],
    journal: [],
    messages: [],
    combats: [],
    users: [],
    activeUsers: [],
    settings: [],
    folders: [],
    macros: [],
    playlists: [],
    tables: [],
    cards: [],
    packs: [],
  };
}

function socketHarness(initialSnapshot: unknown) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const socket = {
    connected: true,
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const group = listeners.get(event) ?? new Set();
      group.add(listener);
      listeners.set(event, group);
      return socket;
    }),
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const once = (...args: unknown[]) => {
        socket.off(event, once);
        listener(...args);
      };
      return socket.on(event, once);
    }),
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
      return socket;
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      if (event === 'world' && typeof args[0] === 'function') {
        args[0](initialSnapshot);
      }
      return socket;
    }),
    disconnect: vi.fn(() => {
      socket.connected = false;
      return socket;
    }),
  };
  return {
    socket,
    fire(event: string, ...args: unknown[]) {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        listener(...args);
      }
    },
  };
}

describe('native provider trust boundaries', () => {
  const clients = new Set<SocketIOProvider>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axios.create).mockReturnValue({} as ReturnType<typeof axios.create>);
    vi.mocked(authenticateFoundry).mockResolvedValue({ session: 'session-a', userId: 'user-a' });
  });

  afterEach(async () => {
    for (const client of clients) {
      await client.disconnect();
    }
    clients.clear();
    vi.resetAllMocks();
  });

  function provider(timeout = 1000) {
    const client = new SocketIOProvider({
      kind: 'socketio',
      baseUrl: 'http://localhost:30000',
      username: 'GM',
      password: 'secret',
      writeEnabled: true,
      timeout,
    });
    clients.add(client);
    return client;
  }

  async function connect(worldData: unknown = snapshot(), client = provider()) {
    const harness = socketHarness(worldData);
    vi.mocked(io).mockReturnValue(harness.socket as unknown as ReturnType<typeof io>);
    const connecting = client.connect();
    await Promise.resolve();
    harness.fire('session', { userId: 'user-a' });
    await connecting;
    return { client, ...harness };
  }

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'normalizes invalid legacy client timeouts (%s) before authentication and snapshot loading',
    async (timeout) => {
      await connect(snapshot(), provider(timeout));
      expect(vi.mocked(authenticateFoundry).mock.calls[0]?.[4]?.timeout).toBe(10000);
    },
  );

  it.each([
    null,
    undefined,
    {},
    { result: 'invalid' },
    { result: [42] },
    { result: [{ _id: ITEM_ID }] },
  ])('does not confirm a delete from malformed acknowledgement %j', async (response) => {
    const { client, socket } = await connect();
    socket.emit.mockClear();
    socket.emit.mockImplementation((_event: string, ...args: unknown[]) => {
      const acknowledge = args[1];
      if (typeof acknowledge === 'function') {
        acknowledge(response);
      }
      return socket;
    });
    await expect(client.deleteActorItem(ACTOR_ID, ITEM_ID)).rejects.toMatchObject({
      code: 'outcome_unknown',
    });
    expect(client.isWorldDataStale()).toBe(true);
    expect(socket.emit).toHaveBeenCalledOnce();
  });

  it.each([{ result: [] }, { result: [{}] }, { result: [{ _id: 42 }] }])(
    'does not confirm an update without a returned document: $result',
    async ({ result }) => {
      const { client, socket } = await connect();
      socket.emit.mockClear();
      socket.emit.mockImplementation((_event: string, ...args: unknown[]) => {
        if (typeof args[1] === 'function') {
          args[1]({ result });
        }
        return socket;
      });
      await expect(client.updateCombat(COMBAT_ID, { round: 2 })).rejects.toMatchObject({
        code: 'outcome_unknown',
      });
      expect(client.isWorldDataStale()).toBe(true);
      expect(socket.emit).toHaveBeenCalledOnce();
    },
  );

  it('distinguishes a confirmed remote rejection from an unknown outcome', async () => {
    const { client, socket } = await connect();
    socket.emit.mockClear();
    socket.emit.mockImplementation((_event: string, ...args: unknown[]) => {
      if (typeof args[1] === 'function') {
        args[1]({ error: { message: 'Permission denied' } });
      }
      return socket;
    });
    await expect(client.deleteActorItem(ACTOR_ID, ITEM_ID)).rejects.toMatchObject({
      code: 'execution_rejected',
    });
    expect(client.isWorldDataStale()).toBe(false);
    expect(socket.emit).toHaveBeenCalledOnce();
  });

  it('accepts a confirmed idempotent delete with no remaining documents', async () => {
    const { client, socket } = await connect();
    socket.emit.mockImplementation((_event: string, ...args: unknown[]) => {
      if (typeof args[1] === 'function') {
        args[1]({ result: [] });
      }
      return socket;
    });
    await expect(client.deleteActorItem(ACTOR_ID, ITEM_ID)).resolves.toBeUndefined();
    expect(client.isWorldDataStale()).toBe(false);
  });

  it('expires a mutation before dispatch without marking the cache stale', async () => {
    const { client, socket } = await connect();
    socket.emit.mockClear();
    const context = new ProviderOperationContext(() => {});
    context.finish();
    const mutation = withOperationContext(context, () => client.deleteActorItem(ACTOR_ID, ITEM_ID));
    await expect(mutation).rejects.toMatchObject({ code: 'session_changed' });
    await context.drain();
    expect(socket.emit).not.toHaveBeenCalled();
    expect(client.isWorldDataStale()).toBe(false);
  });

  it.each([undefined, null, {}, { id: '' }, { id: '   ' }, { id: 12 }])(
    'does not become ready with an unidentified world: %j',
    async (world) => {
      const client = provider();
      await expect(connect({ ...snapshot(), world }, client)).rejects.toMatchObject({
        code: 'invalid_response',
      });
      expect(client.isConnected()).toBe(false);
      expect(client.hasWorldData()).toBe(false);
    },
  );

  it('rejects an unidentified refresh and preserves the previous snapshot', async () => {
    const { client, fire } = await connect();
    const previous = client.getWorldData();
    const refresh = client.refreshWorldData();
    fire('world', { ...snapshot(), world: {} });
    await expect(refresh).rejects.toMatchObject({ code: 'invalid_response' });
    expect(client.getWorldData()).toBe(previous);
    expect(client.isWorldDataStale()).toBe(true);
  });

  it('discards an expired refresh in the same provider generation', async () => {
    const { client, fire } = await connect();
    const context = new ProviderOperationContext(() => {});
    const generation = client.getGeneration();
    const refreshing = withOperationContext(context, () => client.refreshWorldData());
    context.finish();
    const replacement = snapshot();
    replacement.world.title = 'New snapshot';
    Reflect.set(client, 'worldData', replacement);
    fire('world', { ...snapshot(), world: { id: 'world-a', title: 'Old snapshot' } });
    await expect(refreshing).rejects.toMatchObject({ code: 'session_changed' });
    expect(client.getGeneration()).toBe(generation);
    expect(client.getWorldData()).toBe(replacement);
    expect(client.isWorldDataStale()).toBe(false);
  });

  it('does not turn getWorldInfo display defaults into a session identity', async () => {
    const { client } = await connect();
    const world = client.getWorldData();
    if (!world) {
      throw new Error('Expected a cached world');
    }
    world.world = {};
    await expect(client.inspect()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('applies journal page changes to later reads', async () => {
    const world = snapshot();
    world.journal.push({ _id: 'journal-a', name: 'Lore', pages: [] });
    const { client, fire } = await connect(world);
    const operation = { parentUuid: 'JournalEntry.journal-a' };
    fire('modifyDocument', {
      type: 'JournalEntryPage',
      action: 'create',
      operation,
      result: [
        {
          _id: 'page-a',
          name: 'Chapter',
          type: 'text',
          text: { content: 'Old lore', format: 1 },
        },
      ],
    });
    fire('modifyDocument', {
      type: 'JournalEntryPage',
      action: 'update',
      operation,
      result: [{ _id: 'page-a', text: { content: 'New lore' } }],
    });
    expect(client.getJournals()[0]?.pages?.[0]?.text?.content).toBe('New lore');
    expect(client.searchWorld('New lore').journals).toHaveLength(1);
    expect(client.isWorldDataStale()).toBe(false);
    fire('modifyDocument', {
      type: 'JournalEntryPage',
      action: 'delete',
      operation,
      result: ['page-a'],
    });
    expect(client.getJournals()[0]?.pages).toEqual([]);
    expect(client.isWorldDataStale()).toBe(false);
  });

  it.each([
    { type: 'Actor', action: 'update', result: [{ _id: ACTOR_ID, name: 'Missing actor' }] },
    {
      type: 'JournalEntryPage',
      action: 'update',
      result: [{ _id: 'page-a' }],
      operation: { parentUuid: 'JournalEntry.missing' },
    },
    { type: 'Actor', action: 'update', result: 'invalid' },
  ])('marks unhandled broadcasts stale: %j', async (event) => {
    const { client, fire } = await connect();
    fire('modifyDocument', event);
    expect(client.isWorldDataStale()).toBe(true);
    expect((await client.inspect()).ready).toBe(false);
  });

  it('keeps irrelevant traffic and duplicate deletes fresh', async () => {
    const { client, fire } = await connect();
    fire('modifyDocument', { type: 'Setting', action: 'update', result: [{ _id: 'setting' }] });
    fire('modifyDocument', { type: 'Actor', action: 'delete', result: [ACTOR_ID] });
    expect(client.isWorldDataStale()).toBe(false);
  });

  it('cancels authentication on disconnect before a world socket can be opened', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(authenticateFoundry).mockImplementation((_url, _user, _password, _path, options) => {
      signal = options?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason), { once: true });
      });
    });
    const client = provider();
    const connecting = client.connect();
    const rejected = expect(connecting).rejects.toMatchObject({ code: 'session_changed' });
    expect(signal?.aborted).toBe(false);
    expect(vi.mocked(authenticateFoundry).mock.calls[0]?.[4]?.timeout).toBe(1000);
    await client.disconnect();
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(io).not.toHaveBeenCalled();
    expect(client.isConnected()).toBe(false);
  });

  it('keeps replacement authentication cancellable', async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(authenticateFoundry).mockImplementation((_url, _user, _password, _path, options) => {
      const signal = options?.signal;
      if (!signal) {
        throw new Error('Expected a connection-owned signal');
      }
      signals.push(signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const client = provider();
    const first = client.connect();
    const firstRejected = expect(first).rejects.toMatchObject({ code: 'session_changed' });
    const second = client.connect();
    const secondRejected = expect(second).rejects.toMatchObject({ code: 'session_changed' });
    await firstRejected;
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    await client.disconnect();
    await secondRejected;
    expect(signals[1]?.aborted).toBe(true);
    expect(io).not.toHaveBeenCalled();
  });
});
