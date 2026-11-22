import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompositeProvider } from '../composite.js';
import { createProvider } from '../factory.js';
import { projectActor, projectItem, validateSystemPatch } from '../projections.js';
import { RestApiProvider } from '../rest-api.js';
import { SocketIOProvider } from '../socketio.js';

const snapshot = () => ({
  userId: 'user-a',
  world: { id: 'world-a', title: 'A' },
  system: { id: 'dnd5e', version: 'test' },
  release: { version: 'test' },
  modules: [{ id: 'item-piles', title: 'Item Piles', version: 'test', active: true }],
  actors: [],
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
});
const envelope = () => ({ snapshot: snapshot(), origin: 'https://foundry.example', ready: true });
const servers: Server[] = [];
async function relay(
  handler: (
    body: Record<string, unknown>,
    respond: (body: unknown, status?: number) => void,
  ) => void,
) {
  const requests: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    let content = '';
    req.on('data', (chunk) => {
      content += chunk;
    });
    req.on('end', () => {
      const body = JSON.parse(content) as Record<string, unknown>;
      requests.push(body);
      handler(body, (value, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      });
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('No listen address');
  }
  return { url: `http://127.0.0.1:${address.port}`, requests };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe('Provider execution boundary', () => {
  it('hydrates a session-owned snapshot and preserves the original integration ID', async () => {
    const endpoint = await relay((_body, respond) =>
      respond({ success: true, result: envelope() }),
    );
    const provider = new RestApiProvider({
      kind: 'rest-api',
      relayUrl: endpoint.url,
      clientId: 'paired-a',
      apiKey: 'test-key',
    });
    await provider.connect();
    expect((await provider.inspect()).modules[0]?.id).toBe('item-piles');
    expect(provider.hasWorldData()).toBe(true);
    expect(endpoint.requests[0]?.clientId).toBe('paired-a');
    await provider.disconnect();
    expect(provider.getWorldData()).toBeNull();
  });

  it('rejects a different world before exposing a connected session', async () => {
    const endpoint = await relay((_body, respond) =>
      respond({ success: true, result: envelope() }),
    );
    const provider = new RestApiProvider({
      kind: 'rest-api',
      relayUrl: endpoint.url,
      clientId: 'paired-a',
      apiKey: 'test-key',
      expectedWorldId: 'other-world',
    });
    await expect(provider.connect()).rejects.toMatchObject({ code: 'identity_mismatch' });
    expect(provider.isConnected()).toBe(false);
    expect(provider.getWorldData()).toBeNull();
  });

  it('serializes caller values as data in a fixed binding', async () => {
    const endpoint = await relay((_body, respond) =>
      respond({ success: true, result: envelope() }),
    );
    const provider = new RestApiProvider({
      kind: 'rest-api',
      relayUrl: endpoint.url,
      clientId: 'paired-a',
      apiKey: 'test-key',
    });
    await provider.connect();
    const value = "'); throw new Error('injected'); //";
    await provider.execute('return args.value;', { value }, { readOnly: true });
    const request = endpoint.requests.at(-1);
    expect(request?.script).toContain(`const args = ${JSON.stringify({ value })};`);
    expect(request?.script).toContain('return args.value;');
  });

  it('keeps writes disabled without dispatching a request', async () => {
    const endpoint = await relay((_body, respond) =>
      respond({ success: true, result: envelope() }),
    );
    const provider = new RestApiProvider({
      kind: 'rest-api',
      relayUrl: endpoint.url,
      clientId: 'paired-a',
      apiKey: 'test-key',
    });
    await provider.connect();
    await expect(provider.execute('return 1;', {}, { readOnly: false })).rejects.toMatchObject({
      code: 'writes_disabled',
    });
    expect(endpoint.requests).toHaveLength(1);
  });

  it('reports an ambiguous write timeout and never repeats the request', async () => {
    let count = 0;
    const endpoint = await relay((_body, respond) => {
      if (++count === 1) {
        respond({ success: true, result: envelope() });
      }
    });
    const provider = new RestApiProvider({
      kind: 'rest-api',
      relayUrl: endpoint.url,
      clientId: 'paired-a',
      apiKey: 'test-key',
      writeEnabled: true,
      timeout: 30,
    });
    await provider.connect();
    await expect(provider.execute('return 1;', {}, { readOnly: false })).rejects.toMatchObject({
      code: 'outcome_unknown',
    });
    expect(endpoint.requests).toHaveLength(2);
  });

  it('surfaces a failed execution envelope instead of treating HTTP 200 as success', async () => {
    let count = 0;
    const endpoint = await relay((_body, respond) => {
      respond(
        ++count === 1
          ? { success: true, result: envelope() }
          : { success: false, error: 'Permission denied' },
      );
    });
    const provider = new RestApiProvider({
      kind: 'rest-api',
      relayUrl: endpoint.url,
      clientId: 'paired-a',
      apiKey: 'test-key',
    });
    await provider.connect();
    const generation = provider.getGeneration();
    await expect(provider.execute('return 1;', {}, { readOnly: true })).rejects.toMatchObject({
      code: 'execution_rejected',
    });
    expect(provider.isConnected()).toBe(true);
    expect(provider.isWorldDataStale()).toBe(false);
    expect(provider.getGeneration()).toBe(generation);
  });

  it('latches a confirmed identity change offline and cancels pending runtime work', async () => {
    let count = 0;
    let signalPending = () => {};
    const received = new Promise<void>((resolve) => {
      signalPending = resolve;
    });
    const endpoint = await relay((_body, respond) => {
      if (++count === 2) {
        signalPending();
        return;
      }
      respond({
        success: true,
        result: count === 3 ? { __foundryMcpError: 'identity_mismatch' } : envelope(),
      });
    });
    const provider = new RestApiProvider({
      kind: 'rest-api',
      relayUrl: endpoint.url,
      clientId: 'paired-a',
      apiKey: 'test-key',
    });
    await provider.connect();
    const generation = provider.getGeneration();
    const request = provider.execute('return 1;', {}, { readOnly: true });
    const cancelled = expect(request).rejects.toMatchObject({ code: 'target_offline' });
    await received;
    expect(provider.isWorldDataStale()).toBe(false);
    await expect(provider.execute('return 1;', {}, { readOnly: true })).rejects.toMatchObject({
      code: 'identity_mismatch',
    });
    await cancelled;
    expect(provider.isConnected()).toBe(false);
    expect(provider.isWorldDataStale()).toBe(true);
    expect(provider.getGeneration()).toBe(generation + 1);
    await expect(provider.inspect()).rejects.toMatchObject({ code: 'target_offline' });
    await expect(provider.refreshWorldData()).rejects.toMatchObject({ code: 'target_offline' });
    await expect(provider.execute('return 1;', {}, { readOnly: true })).rejects.toMatchObject({
      code: 'target_offline',
    });
    expect(endpoint.requests).toHaveLength(3);
    await provider.connect();
    expect(provider.isConnected()).toBe(true);
    expect(provider.isWorldDataStale()).toBe(false);
    expect((await provider.inspect()).ready).toBe(true);
    expect(endpoint.requests).toHaveLength(4);
    await provider.disconnect();
  });

  it('does not infer identity changes from unrelated result properties', async () => {
    let count = 0;
    const result = { __foundryMcpError: 'unrelated_error' };
    const endpoint = await relay((_body, respond) => {
      respond({ success: true, result: ++count === 1 ? envelope() : result });
    });
    const provider = new RestApiProvider({
      kind: 'rest-api',
      relayUrl: endpoint.url,
      clientId: 'paired-a',
      apiKey: 'test-key',
    });
    await provider.connect();
    const generation = provider.getGeneration();
    await expect(provider.execute('return args;', {}, { readOnly: true })).resolves.toEqual(result);
    expect(provider.isConnected()).toBe(true);
    expect(provider.isWorldDataStale()).toBe(false);
    expect(provider.getGeneration()).toBe(generation);
    await provider.disconnect();
  });

  it('invalidates the relay snapshot before a write whose runtime reports failure', async () => {
    let count = 0;
    const endpoint = await relay((_body, respond) => {
      respond(
        ++count === 2
          ? { success: false, error: 'The script failed after updating a document' }
          : { success: true, result: envelope() },
      );
    });
    const provider = new RestApiProvider({
      kind: 'rest-api',
      relayUrl: endpoint.url,
      clientId: 'paired-a',
      apiKey: 'test-key',
      writeEnabled: true,
    });
    await provider.connect();
    expect(provider.isWorldDataStale()).toBe(false);
    const write = provider.execute('return 1;', {}, { readOnly: false });
    expect(provider.isWorldDataStale()).toBe(true);
    await expect(write).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(provider.isConnected()).toBe(true);
    expect(provider.isWorldDataStale()).toBe(true);
    expect(endpoint.requests).toHaveLength(2);
    await provider.refreshWorldData();
    expect(provider.isWorldDataStale()).toBe(false);
  });

  it('invalidates again when a write finishes after a concurrent snapshot refresh', async () => {
    let count = 0;
    let signalWrite = () => {};
    const received = new Promise<void>((resolve) => {
      signalWrite = resolve;
    });
    const pending: { respond?: (body: unknown) => void } = {};
    const endpoint = await relay((_body, respond) => {
      if (++count === 2) {
        pending.respond = respond;
        signalWrite();
        return;
      }
      respond({ success: true, result: envelope() });
    });
    const provider = new RestApiProvider({
      kind: 'rest-api',
      relayUrl: endpoint.url,
      clientId: 'paired-a',
      apiKey: 'test-key',
      writeEnabled: true,
    });
    await provider.connect();
    const write = provider.execute('return 1;', {}, { readOnly: false });
    await received;
    expect(provider.isWorldDataStale()).toBe(true);
    await provider.refreshWorldData();
    expect(provider.isWorldDataStale()).toBe(false);
    if (!pending.respond) {
      throw new Error('The write request was not received');
    }
    pending.respond({ success: true, result: 1 });
    await expect(write).resolves.toBe(1);
    expect(provider.isWorldDataStale()).toBe(true);
    expect(endpoint.requests).toHaveLength(3);
    await provider.disconnect();
  });

  it('does not invalidate a replacement session when an old write completes', async () => {
    let count = 0;
    let signalWrite = () => {};
    const received = new Promise<void>((resolve) => {
      signalWrite = resolve;
    });
    const pending: { respond?: (body: unknown) => void } = {};
    const endpoint = await relay((_body, respond) => {
      if (++count === 2) {
        pending.respond = respond;
        signalWrite();
        return;
      }
      respond({ success: true, result: envelope() });
    });
    const provider = new RestApiProvider({
      kind: 'rest-api',
      relayUrl: endpoint.url,
      clientId: 'paired-a',
      apiKey: 'test-key',
      writeEnabled: true,
    });
    await provider.connect();
    const write = provider.execute('return 1;', {}, { readOnly: false });
    const rejected = expect(write).rejects.toMatchObject({ code: 'outcome_unknown' });
    await received;
    await provider.connect();
    expect(provider.isWorldDataStale()).toBe(false);
    if (!pending.respond) {
      throw new Error('The write request was not received');
    }
    pending.respond({ success: true, result: 1 });
    await rejected;
    expect(provider.isConnected()).toBe(true);
    expect(provider.isWorldDataStale()).toBe(false);
    await provider.disconnect();
  });

  it('does not infer runtime execution capability from a Socket.IO connection', async () => {
    const provider = new SocketIOProvider({ kind: 'socketio', baseUrl: 'http://localhost:30000' });
    expect(provider.capabilities.has('runtime.execute')).toBe(false);
    await expect(provider.execute('return 1;', {}, { readOnly: true })).rejects.toMatchObject({
      code: 'unsupported_operation',
    });
  });

  it('selects the historical REST contract explicitly', () => {
    const provider = createProvider({
      kind: 'legacy-rest',
      baseUrl: 'http://localhost:30000',
      apiKey: 'test',
    });
    expect(provider.kind).toBe('legacy-rest');
    expect(provider.capabilities.has('diagnostics.read')).toBe(true);
    expect(provider.capabilities.has('runtime.execute')).toBe(false);
  });

  it('rejects composition of clients from different worlds', async () => {
    const endpoint = await relay((_body, respond) =>
      respond({ success: true, result: envelope() }),
    );
    vi.spyOn(SocketIOProvider.prototype, 'connect').mockResolvedValue();
    vi.spyOn(SocketIOProvider.prototype, 'disconnect').mockResolvedValue();
    vi.spyOn(SocketIOProvider.prototype, 'inspect').mockResolvedValue({
      world: { id: 'world-b', title: 'B' },
      system: { id: 'dnd5e', version: 'test' },
      foundryVersion: 'test',
      modules: [],
      ready: true,
      origin: 'https://foundry.example',
    });
    const provider = new CompositeProvider({
      kind: 'composite',
      core: { kind: 'socketio', baseUrl: 'https://foundry.example' },
      execution: {
        kind: 'rest-api',
        relayUrl: endpoint.url,
        apiKey: 'test-key',
        clientId: 'paired-a',
      },
    });
    await expect(provider.connect()).rejects.toMatchObject({ code: 'identity_mismatch' });
  });

  it('discards a native snapshot that arrives after disconnect', async () => {
    const provider = new SocketIOProvider({ kind: 'socketio', baseUrl: 'http://localhost:30000' });
    let response: ((data: unknown) => void) | undefined;
    const socket = {
      connected: true,
      once: vi.fn((_event: string, callback: (data: unknown) => void) => {
        response = callback;
      }),
      off: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
    Reflect.set(provider, 'socket', socket);
    const refresh = provider.refreshWorldData();
    const rejected = expect(refresh).rejects.toMatchObject({ code: 'session_changed' });
    await provider.disconnect();
    await rejected;
    response?.(snapshot());
    expect(provider.getWorldData()).toBeNull();
    expect(socket.off).toHaveBeenCalledWith('world', expect.any(Function));
  });

  it('marks an interrupted native mutation as unknown and never resends it', async () => {
    const provider = new SocketIOProvider({
      kind: 'socketio',
      baseUrl: 'http://localhost:30000',
      writeEnabled: true,
    });
    const socket = { connected: true, off: vi.fn(), emit: vi.fn(), disconnect: vi.fn() };
    Reflect.set(provider, 'socket', socket);
    const write = provider.deleteActorItem('abcdefghijklmnop', 'ponmlkjihgfedcba');
    const rejected = expect(write).rejects.toMatchObject({ code: 'outcome_unknown' });
    await provider.disconnect();
    await rejected;
    expect(socket.emit).toHaveBeenCalledTimes(1);
  });

  it('invalidates the native snapshot when an acknowledgement times out on a live socket', async () => {
    const provider = new SocketIOProvider({
      kind: 'socketio',
      baseUrl: 'http://localhost:30000',
      writeEnabled: true,
      timeout: 20,
    });
    const socket = { connected: true, off: vi.fn(), emit: vi.fn(), disconnect: vi.fn() };
    Reflect.set(provider, 'socket', socket);
    Reflect.set(provider, '_isConnected', true);
    Reflect.set(provider, 'worldData', snapshot());
    expect(provider.isWorldDataStale()).toBe(false);
    await expect(
      provider.deleteActorItem('abcdefghijklmnop', 'ponmlkjihgfedcba'),
    ).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(provider.isConnected()).toBe(true);
    expect(provider.isWorldDataStale()).toBe(true);
    expect(socket.emit).toHaveBeenCalledTimes(1);
    await provider.disconnect();
  });

  it('reports staleness from either side of a composed provider', () => {
    const runtimeStale = vi
      .spyOn(RestApiProvider.prototype, 'isWorldDataStale')
      .mockReturnValue(false);
    const provider = new CompositeProvider({
      kind: 'composite',
      core: { kind: 'socketio', baseUrl: 'https://foundry.example' },
      execution: {
        kind: 'rest-api',
        relayUrl: 'http://localhost:30001',
        apiKey: 'test-key',
        clientId: 'paired-a',
      },
    });
    expect(provider.isWorldDataStale()).toBe(false);
    runtimeStale.mockReturnValue(true);
    expect(provider.isWorldDataStale()).toBe(true);
    runtimeStale.mockReturnValue(false);
    Reflect.set(provider, 'worldDataStale', true);
    expect(provider.isWorldDataStale()).toBe(true);
  });

  it('keeps system interpretations out of an unknown system', () => {
    const actor = {
      _id: 'actor',
      name: 'Hero',
      type: 'character',
      system: { attributes: { hp: { value: 10, max: 20 } } },
    };
    expect(projectActor(actor, 'unknown-system').hp).toBeUndefined();
    expect(projectActor(actor, 'unknown-system').data).toEqual(actor.system);
    expect(projectActor(actor, 'dnd5e', '14.370').hp).toEqual({ value: 10, max: 20 });
    expect(() =>
      validateSystemPatch(
        { 'attributes.hp.value': 25 },
        projectActor(actor, 'unknown-system'),
        actor.system,
        'unknown-system',
      ),
    ).not.toThrow();
    expect(() =>
      validateSystemPatch(
        { 'attributes.hp.value': 25 },
        projectActor(actor, 'dnd5e', '14.370'),
        actor.system,
        'dnd5e',
        '14.370',
      ),
    ).toThrow(/exceeds max/);
  });

  it('selects projections by Foundry generation without borrowing another variant', () => {
    const actor = {
      _id: 'actor',
      name: 'Hero',
      type: 'character',
      system: { attributes: { hp: { value: 10, max: 20 } } },
    };
    const item = {
      _id: 'item',
      name: 'Sword',
      type: 'weapon',
      system: { description: { value: 'Description' }, rarity: 'rare' },
    };
    for (const version of ['13.350', '14.370']) {
      expect(projectActor(actor, 'dnd5e', version).hp).toEqual({ value: 10, max: 20 });
      expect(projectItem(item, 'dnd5e', version).rarity).toBe('rare');
    }
    for (const version of ['12.331', '15.400', 'unknown', undefined]) {
      const projected = projectActor(actor, 'dnd5e', version);
      expect(projected.hp).toBeUndefined();
      expect(projected.data).toEqual(actor.system);
      expect(projectItem(item, 'dnd5e', version).rarity).toBeUndefined();
      expect(() =>
        validateSystemPatch(
          { 'attributes.hp.value': 25 },
          projected,
          actor.system,
          'dnd5e',
          version,
        ),
      ).not.toThrow();
      expect(() =>
        validateSystemPatch(
          { 'attributes.hp.value': Number.NaN },
          projected,
          actor.system,
          'dnd5e',
          version,
        ),
      ).toThrow(/finite scalar/);
    }
    // A cached descriptor for 13/14 must not change the decision for another target.
    expect(projectActor(actor, 'dnd5e', '13.350').hp).toEqual({ value: 10, max: 20 });
  });

  it.each([
    [{ generation: 14 }, '14', true],
    [{ generation: '13' }, '13', true],
    [{ version: '14.370', generation: 13 }, '14.370', true],
    [{ version: 'unknown', generation: 14 }, 'unknown', false],
    [{ generation: 15 }, '15', false],
    [{ generation: Number.NaN }, 'unknown', false],
  ])('uses the same release identity for discovery and projections: %j', async (release, expected, projected) => {
    const provider = new SocketIOProvider({
      kind: 'socketio',
      baseUrl: 'https://foundry.example',
    });
    const actor = {
      _id: 'aaaaaaaaaaaaaaaa',
      name: 'Hero',
      type: 'character',
      system: { attributes: { hp: { value: 10, max: 20 } } },
    };
    Reflect.set(provider, 'worldData', { ...snapshot(), release, actors: [actor] });
    vi.spyOn(provider, 'isConnected').mockReturnValue(true);
    expect((await provider.getWorldInfo()).coreVersion).toBe(expected);
    expect((await provider.inspect()).foundryVersion).toBe(expected);
    const result = await provider.getActor(actor._id);
    expect(result.hp).toEqual(projected ? { value: 10, max: 20 } : undefined);
  });
});
