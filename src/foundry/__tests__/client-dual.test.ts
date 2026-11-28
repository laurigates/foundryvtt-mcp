/**
 * Dual transport: Socket.IO primary, REST bridge as an optional augment.
 *
 * Bodies below mirror what the bridge answers (see rest-mappers.test.ts for
 * the source of each shape): the module's `{ success, data }` envelope with
 * its own field names.
 */

import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');
vi.mock('socket.io-client');
vi.mock('../auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth.js')>();
  return {
    authenticateFoundry: vi.fn(),
    sessionSocketOptions: actual.sessionSocketOptions,
    socketOrigin: actual.socketOrigin,
  };
});
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../config/index.js', () => ({ config: { logLevel: 'info' } }));

const { FoundryClient } = await import('../client.js');
const { SocketIOProvider } = await import('../../providers/socketio.js');
const { LegacyRestProvider } = await import('../../providers/legacy-rest.js');
const { logger } = await import('../../utils/logger.js');
const { io } = await import('socket.io-client');
const { authenticateFoundry } = await import('../auth.js');

const FOUNDRY_URL = 'http://foundry.example:30000';
const BRIDGE_URL = 'http://bridge.example:3030';
const ACTOR_ID = 'actor0000000000c';

interface MockAxiosInstance {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  interceptors: {
    request: { use: ReturnType<typeof vi.fn> };
    response: { use: ReturnType<typeof vi.fn> };
  };
}

function mockAxiosInstance(): MockAxiosInstance {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
}

/** A dnd5e 6.x character as Socket.IO delivers it: source data, no prepared values. */
const SOURCE_CHARACTER = {
  _id: ACTOR_ID,
  name: 'Source Paladin',
  type: 'character',
  system: {
    details: { level: null },
    abilities: { str: { value: 18 }, dex: { value: 11 } },
    attributes: {
      ac: { calc: 'default', formula: '' },
      hp: { value: 51, max: null, temp: 0 },
    },
  },
  items: [{ _id: 'class000000000p1', name: 'Paladin', type: 'class', system: { levels: 7 } }],
};

const WORLD_DATA = {
  userId: 'test-user-id',
  world: { id: 'w', title: 'Test World' },
  system: { id: 'dnd5e', version: '6.0.6' },
  release: { version: '14.369' },
  actors: [SOURCE_CHARACTER],
  scenes: [],
  items: [],
  journal: [],
  messages: [],
  combats: [],
  users: [],
  activeUsers: [],
  macros: [],
  playlists: [],
  tables: [],
  folders: [],
};

/** `formatActorDetail` for the same actor after the browser ran prepareData. */
const REST_ACTOR = {
  success: true,
  data: {
    id: ACTOR_ID,
    name: 'Source Paladin',
    type: 'character',
    img: null,
    level: 7,
    hp: { current: 51, max: 64 },
    ac: 18,
    abilities: {
      str: { value: 18, modifier: 4, save: 7, proficient: 1 },
      dex: { value: 11, modifier: 0, save: 0, proficient: 0 },
    },
    skills: {},
  },
};

const REST_WORLD = { success: true, data: { id: 'w', title: 'Test World', system: 'dnd5e' } };

function transportFailure() {
  return Object.assign(new Error('connect ECONNREFUSED 10.0.0.2:3030'), {
    code: 'ECONNREFUSED',
  });
}

/** An HTTP error answer, as axios rejects with it. */
function httpFailure(status: number, data?: unknown) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });
}

/**
 * What the bridge answers when no GM browser client runs the module: its
 * socket request times out after REQUEST_TIMEOUT (5 s by default) and the
 * route turns that into this 500 (bridge-server/routes/actors.js).
 */
function bridgeTimeout500() {
  return httpFailure(500, {
    success: false,
    error: 'Internal Server Error',
    message: 'Failed to communicate with FoundryVTT server',
  });
}

function buildSocket() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const socket = {
    connected: true,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
      return socket;
    }),
    once: vi.fn(),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((h) => h !== handler),
      );
      return socket;
    }),
    emit: vi.fn((event: string, ack?: (payload: unknown) => void) => {
      if (event === 'world' && typeof ack === 'function') {
        ack(structuredClone(WORLD_DATA));
      }
      return socket;
    }),
    disconnect: vi.fn(() => {
      socket.connected = false;
      return socket;
    }),
  };
  const fire = (event: string, ...args: unknown[]) => {
    for (const handler of [...(listeners.get(event) ?? [])]) {
      handler(...args);
    }
  };
  return { socket, listeners, fire };
}

describe('FoundryClient dual transport', () => {
  let http: MockAxiosInstance;
  let rest: MockAxiosInstance;
  let bridgeRead: ReturnType<typeof vi.fn>;
  let bridgeWorld: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    http = mockAxiosInstance();
    rest = mockAxiosInstance();
    bridgeRead = vi.fn();
    bridgeWorld = vi.fn().mockResolvedValue({ data: REST_WORLD });
    rest.get.mockImplementation((url: string, ...args: unknown[]) =>
      url === '/api/world' ? bridgeWorld() : bridgeRead(url, ...args),
    );
    vi.mocked(axios).create = vi.fn((cfg?: { baseURL?: string }) =>
      cfg?.baseURL === BRIDGE_URL ? rest : http,
    ) as never;
    vi.mocked(authenticateFoundry).mockResolvedValue({
      session: 'test-session',
      userId: 'test-user-id',
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  function dualClient() {
    return new FoundryClient({
      baseUrl: FOUNDRY_URL,
      restUrl: BRIDGE_URL,
      apiKey: 'bridge-key',
      username: 'gm',
      password: 'secret',
      retryAttempts: 0,
      retryDelay: 1,
    });
  }

  async function connectDual(
    restWorld: () => Promise<unknown> = async () => ({ data: REST_WORLD }),
  ) {
    const harness = buildSocket();
    vi.mocked(io).mockReturnValue(harness.socket as never);
    bridgeWorld.mockImplementation(restWorld);
    const client = dualClient();
    const connecting = client.connect();
    await vi.waitFor(() => expect(harness.listeners.get('session')?.length).toBe(1));
    harness.fire('session', { userId: 'test-user-id' });
    await connecting;
    return { client, ...harness };
  }

  describe('construction', () => {
    it('reports dual mode', () => {
      expect(dualClient().getTransportMode()).toBe('dual');
    });

    it('keeps an explicit native provider native when a historical apiKey is present', async () => {
      const config = {
        kind: 'socketio' as const,
        baseUrl: FOUNDRY_URL,
        apiKey: 'stale-key',
        username: 'gm',
        password: 'secret',
      };
      const provider = new SocketIOProvider(config);
      expect(provider.kind).toBe('socketio');
      expect(provider.getTransportMode()).toBe('socket');
      expect(provider.capabilities.has('diagnostics.read')).toBe(false);
      await expect(provider.get('/api/diagnostics/logs')).rejects.toMatchObject({
        code: 'unsupported_operation',
      });
      expect(http.get).not.toHaveBeenCalled();
    });

    it('enables the explicit native bridge without changing the core provider', () => {
      const provider = new SocketIOProvider({
        kind: 'socketio',
        baseUrl: FOUNDRY_URL,
        username: 'gm',
        password: 'secret',
        restUrl: BRIDGE_URL,
        restApiKey: 'bridge-key',
        writeEnabled: true,
      });
      expect(provider.kind).toBe('socketio');
      expect(provider.getTransportMode()).toBe('dual');
      expect(provider.capabilities.has('diagnostics.read')).toBe(true);
      expect(provider.capabilities.has('core.write')).toBe(true);
      const restRequest = rest.interceptors.request.use.mock.calls[0]?.[0];
      expect(restRequest({ headers: {} }).headers['x-api-key']).toBe('bridge-key');
    });

    it('keeps explicit legacy-rest read-only even with native credentials and a bridge URL', () => {
      const provider = new LegacyRestProvider({
        kind: 'legacy-rest',
        baseUrl: FOUNDRY_URL,
        apiKey: 'bridge-key',
        restUrl: BRIDGE_URL,
        username: 'gm',
        password: 'secret',
        writeEnabled: true,
      });
      expect(provider.kind).toBe('legacy-rest');
      expect(provider.getTransportMode()).toBe('rest');
      expect(provider.capabilities.has('core.write')).toBe(false);
      expect(provider.getConnectionReport().rest.baseUrl).toBe(BRIDGE_URL);
    });

    it('sends the key only to the bridge, on its own HTTP client', () => {
      dualClient();
      const restRequest = rest.interceptors.request.use.mock.calls[0]?.[0];
      expect(restRequest({ headers: {} }).headers['x-api-key']).toBe('bridge-key');
      expect(http.interceptors.request.use).not.toHaveBeenCalled();
    });

    it('keeps REST-only mode for a key without credentials, exposing the deprecation warning', () => {
      const client = new FoundryClient({ baseUrl: FOUNDRY_URL, apiKey: 'bridge-key' });
      expect(client.getTransportMode()).toBe('rest');
      // The server entrypoint logs these once at startup.
      expect(client.getTransportWarnings().join(' ')).toMatch(/deprecated/i);
    });

    it('rejects an invalid bridge URL', () => {
      expect(
        () =>
          new FoundryClient({
            baseUrl: FOUNDRY_URL,
            restUrl: 'not a url',
            apiKey: 'k',
            username: 'gm',
            password: 'pw',
          }),
      ).toThrow('Invalid restUrl');
    });
  });

  describe('connect', () => {
    it('connects Socket.IO, then probes the bridge', async () => {
      const { client } = await connectDual();

      expect(client.isConnected()).toBe(true);
      expect(rest.get).toHaveBeenCalledWith('/api/world');
      expect(client.getConnectionReport()).toEqual({
        mode: 'dual',
        socket: { used: true, connected: true },
        rest: { configured: true, baseUrl: BRIDGE_URL, reachable: true, state: 'ok' },
      });
    });

    it('still connects when the bridge is down, and reports why', async () => {
      const { client } = await connectDual(async () => {
        throw transportFailure();
      });

      expect(client.isConnected()).toBe(true);
      const report = client.getConnectionReport();
      expect(report.rest.reachable).toBe(false);
      expect(report.rest.state).toBe('unreachable');
      expect(report.rest.lastError).toContain('ECONNREFUSED');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('treats a bare /api/world object as an incompatible bridge: it answered, unusably', async () => {
      const { client } = await connectDual(async () => ({ data: { id: 'w', title: 'T' } }));

      expect(client.isConnected()).toBe(true);
      const report = client.getConnectionReport();
      expect(report.rest.reachable).toBe(true);
      expect(report.rest.state).toBe('invalid-response');
      expect(report.rest.paused).toBeUndefined();
    });

    it('pauses the whole bridge after a 5xx from the connect probe (no GM client)', async () => {
      const { client } = await connectDual(async () => {
        throw bridgeTimeout500();
      });

      expect(client.isConnected()).toBe(true);
      const report = client.getConnectionReport();
      expect(report.rest.reachable).toBe(true);
      expect(report.rest.state).toBe('server-error');
      expect(report.rest.lastError).toBe('HTTP 500: Failed to communicate with FoundryVTT server');
      expect(report.rest.paused).toEqual([
        {
          scope: 'bridge',
          error: 'HTTP 500: Failed to communicate with FoundryVTT server',
          retryInSeconds: 30,
        },
      ]);

      bridgeRead.mockClear();
      rest.post.mockClear();
      await client.getActor(ACTOR_ID);
      expect((await client.rollDice('1d6')).source).toBe('local');
      expect(bridgeRead).not.toHaveBeenCalled();
      expect(rest.post).not.toHaveBeenCalled();
    });

    it('does not pause the bridge when the probe key is rejected (4xx)', async () => {
      const { client } = await connectDual(async () => {
        throw httpFailure(401);
      });

      const report = client.getConnectionReport();
      expect(report.rest.reachable).toBe(true);
      expect(report.rest.state).toBe('rejected');
      expect(report.rest.lastError).toMatch(/FOUNDRY_API_KEY was rejected.*HTTP 401/);
      expect(report.rest.paused).toBeUndefined();
    });
  });

  describe('target identity of the optional bridge', () => {
    it.each([
      { id: 'another-world' },
      { system: 'pf2e' },
      { origin: 'https://another-foundry.example' },
    ])('withholds every bridge capability when /api/world differs: %j', async (change) => {
      const { client } = await connectDual(async () => ({
        data: { ...REST_WORLD, data: { ...REST_WORLD.data, ...change } },
      }));
      bridgeRead.mockResolvedValue({ data: REST_ACTOR });

      const actor = await client.getActor(ACTOR_ID);
      expect(actor.ac).toBeUndefined();
      expect(actor.hp?.value).toBe(51);
      expect((await client.searchCompendium({ query: 'fire' })).restAvailable).toBe(false);
      await expect(client.requestRestDiagnostics('/api/diagnostics/logs')).rejects.toThrow(
        /unavailable/,
      );
      expect(bridgeRead).not.toHaveBeenCalled();
      expect(client.isConnected()).toBe(true);
      expect(client.getConnectionReport().rest.state).toBe('invalid-response');
    });

    it('detects a bridge world switch even while the native connection is unchanged', async () => {
      const { client } = await connectDual();
      const generation = client.getGeneration();
      bridgeWorld.mockResolvedValue({
        data: { ...REST_WORLD, data: { ...REST_WORLD.data, id: 'other' } },
      });
      bridgeRead.mockResolvedValue({ data: REST_ACTOR });

      expect((await client.getActor(ACTOR_ID)).ac).toBeUndefined();
      expect(client.getGeneration()).toBe(generation);
      expect(bridgeRead).not.toHaveBeenCalled();
    });

    it('discards an answer after a world switch without replaying the request', async () => {
      const { client } = await connectDual();
      bridgeWorld.mockResolvedValueOnce({ data: REST_WORLD }).mockResolvedValueOnce({
        data: { ...REST_WORLD, data: { ...REST_WORLD.data, id: 'other' } },
      });
      bridgeRead.mockResolvedValue({ data: REST_ACTOR });

      const actor = await client.getActor(ACTOR_ID);
      expect(actor.ac).toBeUndefined();
      expect(actor.derivedUnavailable).toEqual(['hpMax', 'ac']);
      expect(bridgeRead).toHaveBeenCalledTimes(1);
    });
  });

  describe('bridge errors answered over HTTP (5xx pauses a capability, 4xx does not)', () => {
    it('pauses actor-derived after a 5xx instead of waiting for the bridge timeout on every call', async () => {
      const { client } = await connectDual();
      bridgeRead.mockClear();
      bridgeRead.mockRejectedValue(bridgeTimeout500());

      await client.getActor(ACTOR_ID);
      await client.getActor(ACTOR_ID);
      const result = await client.searchActors({ query: 'paladin' });

      expect(bridgeRead).toHaveBeenCalledTimes(1);
      expect(result.actors[0]?.derivedUnavailable).toEqual(['hpMax', 'ac']);
    });

    it('keeps other capabilities on the bridge while one is paused', async () => {
      const { client } = await connectDual();
      bridgeRead.mockRejectedValue(bridgeTimeout500());
      await client.getActor(ACTOR_ID);
      rest.post.mockResolvedValueOnce({
        data: {
          success: true,
          data: { total: 4, breakdown: [{ dice: '1d6', results: [4], total: 4 }] },
        },
      });

      const roll = await client.rollDice('1d6');

      expect(rest.post).toHaveBeenCalledTimes(1);
      expect(roll.source).toBe('server');
    });

    it('rolls locally without calling the bridge again after a dice 5xx (bridge up, no GM)', async () => {
      const { client } = await connectDual();
      rest.post.mockRejectedValue(bridgeTimeout500());

      const first = await client.rollDice('2d6');
      const second = await client.rollDice('2d6');

      expect(first.source).toBe('local');
      expect(second.source).toBe('local');
      expect(rest.post).toHaveBeenCalledTimes(1);
    });

    it('retries a paused capability once the cooldown has passed', async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      try {
        const { client } = await connectDual();
        bridgeRead.mockClear();
        bridgeRead.mockRejectedValueOnce(bridgeTimeout500());
        await client.getActor(ACTOR_ID);
        await client.getActor(ACTOR_ID);
        expect(bridgeRead).toHaveBeenCalledTimes(1);

        now.mockReturnValue(1_000_000 + 30_001);
        bridgeRead.mockResolvedValueOnce({ data: REST_ACTOR });
        const actor = await client.getActor(ACTOR_ID);

        expect(bridgeRead).toHaveBeenCalledTimes(2);
        expect(actor.ac).toEqual({ value: 18 });
        expect(client.getConnectionReport().rest.paused).toBeUndefined();
      } finally {
        now.mockRestore();
      }
    });

    it('falls back per call on a 4xx and keeps asking the bridge', async () => {
      const { client } = await connectDual();
      bridgeRead.mockClear();
      bridgeRead.mockRejectedValue(httpFailure(400, { success: false, message: 'id is required' }));

      await client.getActor(ACTOR_ID);
      await client.getActor(ACTOR_ID);
      const actor = await client.getActor(ACTOR_ID);

      expect(bridgeRead).toHaveBeenCalledTimes(3);
      expect(actor.derivedUnavailable).toEqual(['hpMax', 'ac']);
    });

    it('reports a 4xx as rejected, a 5xx as a server error with its pause, never as unreachable', async () => {
      const { client } = await connectDual();

      bridgeRead.mockRejectedValueOnce(httpFailure(404));
      await client.getActor(ACTOR_ID);
      expect(client.getConnectionReport().rest).toMatchObject({
        reachable: true,
        state: 'rejected',
        lastError: 'HTTP 404',
      });
      expect(client.getConnectionReport().rest.paused).toBeUndefined();

      bridgeRead.mockRejectedValueOnce(bridgeTimeout500());
      await client.getActor(ACTOR_ID);
      expect(client.getConnectionReport().rest).toMatchObject({
        reachable: true,
        state: 'server-error',
        lastError: 'HTTP 500: Failed to communicate with FoundryVTT server',
        paused: [
          {
            scope: 'actor-derived',
            error: 'HTTP 500: Failed to communicate with FoundryVTT server',
            retryInSeconds: 30,
          },
        ],
      });
    });

    it('pauses system health after a diagnostics 5xx and says so', async () => {
      const { client } = await connectDual();
      bridgeRead.mockClear();
      bridgeRead.mockRejectedValue(httpFailure(500));

      await expect(client.restGet('/api/diagnostics/health')).rejects.toThrow(/HTTP 500/);
      await expect(client.restGet('/api/diagnostics/health')).rejects.toThrow(/paused/);

      expect(bridgeRead).toHaveBeenCalledTimes(1);
    });
  });

  describe('derived actor values (preferred source: REST)', () => {
    it('overlays AC, max HP and save totals from the bridge on the Socket.IO actor', async () => {
      const { client } = await connectDual();
      bridgeRead.mockResolvedValueOnce({ data: REST_ACTOR });

      const actor = await client.getActor(ACTOR_ID);

      expect(bridgeRead).toHaveBeenLastCalledWith(`/api/actors/${ACTOR_ID}`);
      expect(actor.ac).toEqual({ value: 18 });
      expect(actor.hp).toEqual({ value: 51, max: 64, temp: 0 });
      expect(actor.abilities?.str).toEqual({ value: 18, mod: 4, save: 7 });
      expect(actor.derivedUnavailable).toBeUndefined();
      // Base data still comes from Socket.IO: the level is the class-item sum (#309).
      expect(actor.level).toBe(7);
    });

    it('falls back to the Socket.IO answer and its labels when the bridge fails', async () => {
      const { client } = await connectDual();
      bridgeRead.mockRejectedValue(
        Object.assign(new Error('Request failed with status code 500'), {
          response: { status: 500 },
        }),
      );

      const actor = await client.getActor(ACTOR_ID);

      expect(actor.ac).toBeUndefined();
      expect(actor.derivedUnavailable).toEqual(['hpMax', 'ac']);
    });

    it('falls back when the bridge answers an unknown shape', async () => {
      const { client } = await connectDual();
      bridgeRead.mockResolvedValueOnce({ data: { id: ACTOR_ID, hp: { value: 1 } } });

      const actor = await client.getActor(ACTOR_ID);

      expect(actor.derivedUnavailable).toEqual(['hpMax', 'ac']);
    });

    it('logs a failing capability once, not on every call', async () => {
      const { client } = await connectDual();
      vi.mocked(logger.warn).mockClear();
      bridgeRead.mockRejectedValue(
        Object.assign(new Error('HTTP 500'), { response: { status: 500 } }),
      );

      await client.getActor(ACTOR_ID);
      await client.getActor(ACTOR_ID);
      await client.getActor(ACTOR_ID);

      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('stops calling an unreachable bridge for a while instead of paying its timeout each time', async () => {
      const { client } = await connectDual();
      bridgeRead.mockRejectedValue(transportFailure());

      await client.getActor(ACTOR_ID);
      const callsAfterFirst = bridgeRead.mock.calls.length;
      await client.getActor(ACTOR_ID);

      expect(bridgeRead.mock.calls.length).toBe(callsAfterFirst);
    });

    it('overlays search results by actor id', async () => {
      const { client } = await connectDual();
      bridgeRead.mockResolvedValueOnce({
        data: {
          success: true,
          data: [{ ...REST_ACTOR.data, abilities: undefined }],
          total: 1,
          query: {},
        },
      });

      const result = await client.searchActors({ query: 'paladin', limit: 5 });

      expect(bridgeRead).toHaveBeenLastCalledWith('/api/actors', {
        params: { query: 'paladin', limit: 5 },
      });
      expect(result.actors[0]?.hp).toEqual({ value: 51, max: 64, temp: 0 });
      expect(result.actors[0]?.ac).toEqual({ value: 18 });
      expect(result.actors[0]?.derivedUnavailable).toBeUndefined();
    });

    it('keeps Socket.IO search results when the bridge search fails', async () => {
      const { client } = await connectDual();
      bridgeRead.mockRejectedValue(new Error('boom'));

      const result = await client.searchActors({ query: 'paladin' });

      expect(result.actors).toHaveLength(1);
      expect(result.actors[0]?.derivedUnavailable).toEqual(['hpMax', 'ac']);
    });
  });

  describe('Socket.IO-preferred reads do not touch the bridge', () => {
    it('reads world info from the snapshot', async () => {
      const { client } = await connectDual();
      bridgeRead.mockClear();

      const world = await client.getWorldInfo();

      expect(world.title).toBe('Test World');
      expect(bridgeRead).not.toHaveBeenCalled();
    });
  });

  describe('dice (preferred source: REST, then the local roller)', () => {
    it('rolls on the bridge and maps its result', async () => {
      const { client } = await connectDual();
      rest.post.mockResolvedValueOnce({
        data: {
          success: true,
          data: { total: 17, breakdown: [{ dice: '1d20', results: [12], total: 12 }] },
        },
      });

      const roll = await client.rollDice('1d20+5', 'Athletics');

      expect(rest.post).toHaveBeenCalledWith('/api/dice/roll', {
        formula: '1d20+5',
        reason: 'Athletics',
      });
      expect(roll).toMatchObject({ total: 17, breakdown: '1d20: 12', source: 'server' });
    });

    it('rolls locally when the bridge fails', async () => {
      const { client } = await connectDual();
      rest.post.mockRejectedValueOnce(transportFailure());

      const roll = await client.rollDice('2d6');

      expect(roll.source).toBe('local');
    });
  });

  describe('compendium (REST only)', () => {
    it('maps the bridge answer', async () => {
      const { client } = await connectDual();
      bridgeRead.mockResolvedValueOnce({
        data: {
          success: true,
          data: [
            {
              compendiumId: 'dnd5e.spells',
              itemId: 'spellaaaaaaaaaaa',
              name: 'Fireball',
              type: 'spell',
            },
          ],
          total: 1,
        },
      });

      const result = await client.searchCompendium({ query: 'fire' });

      expect(result.restAvailable).toBe(true);
      expect(result.results[0]?.name).toBe('Fireball');
    });

    it('degrades to the unavailable result, with the reason, when the bridge call fails', async () => {
      const { client } = await connectDual();
      bridgeRead.mockRejectedValueOnce(
        Object.assign(new Error('Request failed with status code 404'), {
          response: { status: 404 },
        }),
      );

      const result = await client.searchCompendium({ query: 'fire' });

      expect(result.restAvailable).toBe(false);
      expect(result.results).toEqual([]);
      expect(result.unavailableReason).toMatch(/REST bridge/);
    });
  });

  describe('restGet (diagnostics)', () => {
    it('returns the bridge body in dual mode', async () => {
      const { client } = await connectDual();
      bridgeRead.mockResolvedValueOnce({ data: { logs: [], total: 0 } });

      await expect(client.restGet('/api/diagnostics/logs')).resolves.toEqual({
        data: { logs: [], total: 0 },
      });
    });

    it('fails with a clear message when the bridge is down', async () => {
      const { client } = await connectDual();
      bridgeRead.mockRejectedValueOnce(transportFailure());

      await expect(client.restGet('/api/diagnostics/health')).rejects.toThrow(
        /REST bridge.*unavailable/,
      );
    });

    it('says the bridge is not configured in Socket.IO-only mode', async () => {
      const client = new FoundryClient({ baseUrl: FOUNDRY_URL, username: 'gm', password: 'pw' });

      await expect(client.restGet('/api/diagnostics/health')).rejects.toThrow(
        /not configured.*FOUNDRY_API_KEY.*FOUNDRY_REST_URL/,
      );
      expect(http.get).not.toHaveBeenCalled();
    });
  });

  describe('connection report outside dual mode', () => {
    it('shows Socket.IO only, bridge not configured', () => {
      const client = new FoundryClient({ baseUrl: FOUNDRY_URL, username: 'gm', password: 'pw' });
      expect(client.getConnectionReport()).toEqual({
        mode: 'socket',
        socket: { used: true, connected: false },
        rest: { configured: false },
      });
    });

    it('shows REST only, Socket.IO unused', () => {
      const client = new FoundryClient({ baseUrl: FOUNDRY_URL, apiKey: 'k' });
      const report = client.getConnectionReport();
      expect(report.mode).toBe('rest');
      expect(report.socket).toEqual({ used: false, connected: false });
      expect(report.rest.configured).toBe(true);
      expect(report.rest.baseUrl).toBe(FOUNDRY_URL);
    });

    it.each([
      ['a transport failure', transportFailure(), 'unreachable'],
      ['a 5xx', httpFailure(500), 'server-error'],
    ])(
      'reports no bridge pause in REST-only mode after %s on connect (nothing honours it)',
      async (_label, failure, state) => {
        http.get.mockRejectedValue(failure);
        const client = new FoundryClient({ baseUrl: FOUNDRY_URL, apiKey: 'k', retryAttempts: 0 });
        await expect(client.connect()).rejects.toThrow();
        const report = client.getConnectionReport();
        expect(report.rest.state).toBe(state);
        expect(report.rest.paused).toBeUndefined();
      },
    );
  });
});
