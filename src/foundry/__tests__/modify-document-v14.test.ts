/**
 * FoundryVTT v14 `modifyDocument` wire-shape changes (#232).
 *
 * Verified against the 14.369 build (see `.claude/rules/foundry-write-protocol.md`):
 * when a write has server-side side effects, v14 changes two things relative
 * to v13.348.
 *
 *   1. The acknowledgement is `{ results: [...] }` — one response per side
 *      effect (flagged `sideEffect: true`) plus the primary response —
 *      instead of a single response object.
 *   2. Other clients receive the change as a `modifyDocumentBatch` event
 *      carrying `{ results: [...] }`, not as `modifyDocument`.
 *
 * Writes without side effects keep the v13 single-response shape on both
 * channels. A concrete trigger: creating an active Combat while another Combat
 * is active, which makes the server deactivate the old one as a side effect.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorldData } from '../types.js';
import { parseDocumentBroadcastBatch } from '../world-cache.js';

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

const SCENE_ID = 'sceneAAAAAAAAAAA';
const TOKEN_ID = 'tokenAAAAAAAAAAA';
const OLD_COMBAT_ID = 'combatOLDOLDOLD1';
const NEW_COMBAT_ID = 'combatNEWNEWNEW1';
const ACTOR_ID = 'actorAAAAAAAAAAA';
const ITEM_ID = 'itemAAAAAAAAAAAA';

type Ack = (response: unknown) => void;
type Responder = (event: string, request: Record<string, unknown>) => unknown;

/** A side-effect response deactivating the previously active Combat. */
const deactivateOldCombat = {
  type: 'Combat',
  action: 'update',
  operation: {},
  result: [{ _id: OLD_COMBAT_ID, active: false }],
  sideEffect: true,
  broadcast: true,
};

/** Builds a client whose socket answers every write with `respond`. */
function buildWriteClient(respond: Responder) {
  const client = new FoundryClient({ baseUrl: 'http://localhost:30000', writeEnabled: true });
  const emit = vi.fn((event: string, request: Record<string, unknown>, ack: Ack) => {
    ack(respond(event, request));
  });
  (client as unknown as { socket: { connected: boolean; emit: typeof emit } }).socket = {
    connected: true,
    emit,
  };
  return { client, emit };
}

describe('modifyDocument acknowledgement — v14 `{ results }` form', () => {
  it('still returns the result of a single (side-effect-free) response', async () => {
    const { client } = buildWriteClient((_e, req) => ({
      type: 'Combat',
      action: 'create',
      result: [{ _id: NEW_COMBAT_ID, ...(req.operation as { data: object[] }).data[0] }],
    }));
    await expect(client.startCombat(SCENE_ID, [])).resolves.toEqual({
      combatId: NEW_COMBAT_ID,
      combatantCount: 0,
    });
  });

  it('reads the primary response out of a `{ results }` ack that carries side effects', async () => {
    const { client, emit } = buildWriteClient((_e, req) => {
      if (req.type === 'Combat') {
        return {
          results: [
            deactivateOldCombat,
            {
              type: 'Combat',
              action: 'create',
              result: [{ _id: NEW_COMBAT_ID, scene: SCENE_ID, active: true }],
              sideEffect: false,
            },
          ],
        };
      }
      return { type: 'Combatant', action: 'create', result: [{ _id: 'cbtAAAAAAAAAAAAA' }] };
    });

    const result = await client.startCombat(SCENE_ID, [{ tokenId: TOKEN_ID, sceneId: SCENE_ID }]);

    expect(result).toEqual({ combatId: NEW_COMBAT_ID, combatantCount: 1 });
    // The Combatant create must be parented to the new combat, not the one the
    // side effect deactivated.
    const combatantRequest = emit.mock.calls[1]?.[1] as { operation: { parentUuid: string } };
    expect(combatantRequest.operation.parentUuid).toBe(`Combat.${NEW_COMBAT_ID}`);
  });

  it('returns the primary result regardless of where it sits in `results`', async () => {
    const { client } = buildWriteClient(() => ({
      results: [
        { type: 'Item', action: 'create', result: [{ _id: ITEM_ID, name: 'Rope' }] },
        deactivateOldCombat,
      ],
    }));
    const created = await client.createActorItem(ACTOR_ID, {
      type: 'inline',
      item: { name: 'Rope', type: 'loot' },
    });
    expect(created).toMatchObject({ _id: ITEM_ID, name: 'Rope' });
  });

  it('rejects when the primary response inside `results` carries an error', async () => {
    const { client } = buildWriteClient(() => ({
      results: [
        deactivateOldCombat,
        {
          type: 'Combat',
          action: 'create',
          result: [],
          error: { message: 'User lacks permission to create Combat' },
        },
      ],
    }));
    await expect(client.startCombat(SCENE_ID, [])).rejects.toThrow(
      /rejected create Combat: User lacks permission to create Combat/,
    );
  });

  it('still rejects a top-level error on a single response', async () => {
    const { client } = buildWriteClient(() => ({
      type: 'Item',
      action: 'delete',
      result: [],
      error: { message: 'Item does not exist' },
    }));
    await expect(client.deleteActorItem(ACTOR_ID, ITEM_ID)).rejects.toThrow(
      /rejected delete Item: Item does not exist/,
    );
  });

  it('rejects an acknowledgement that is neither shape rather than reporting success', async () => {
    const { client } = buildWriteClient(() => 'not a response');
    await expect(client.deleteActorItem(ACTOR_ID, ITEM_ID)).rejects.toThrow(
      /unrecognized modifyDocument acknowledgement/i,
    );
  });

  it.each([
    { results: [deactivateOldCombat] },
    { results: [deactivateOldCombat, { result: [], sideEffect: false }] },
  ])('does not infer a successful write from side effects or an empty primary: %j', async (ack) => {
    const { client, emit } = buildWriteClient(() => ack);
    Reflect.set(client, 'worldData', { world: { id: 'world' } });
    await expect(client.startCombat(SCENE_ID, [])).rejects.toMatchObject({
      code: 'outcome_unknown',
    });
    expect(client.isWorldDataStale()).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe('parseDocumentBroadcastBatch', () => {
  it('parses every entry of a `{ results }` payload', () => {
    const parsed = parseDocumentBroadcastBatch({
      results: [
        deactivateOldCombat,
        {
          type: 'Combat',
          action: 'create',
          operation: {},
          result: [{ _id: NEW_COMBAT_ID, active: true }],
        },
      ],
    });
    expect(parsed).toEqual([
      { type: 'Combat', action: 'update', result: [{ _id: OLD_COMBAT_ID, active: false }] },
      { type: 'Combat', action: 'create', result: [{ _id: NEW_COMBAT_ID, active: true }] },
    ]);
  });

  it('keeps the parentUuid of an embedded entry', () => {
    const [entry] = parseDocumentBroadcastBatch({
      results: [
        {
          type: 'Region',
          action: 'update',
          operation: { parentUuid: `Scene.${SCENE_ID}` },
          result: [{ _id: 'regionAAAAAAAAAA' }],
        },
      ],
    });
    expect(entry?.parentUuid).toBe(`Scene.${SCENE_ID}`);
  });

  it('drops malformed entries and keeps the valid ones', () => {
    const parsed = parseDocumentBroadcastBatch({
      results: [null, { type: 'Combat', action: 'explode', result: [] }, deactivateOldCombat],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.action).toBe('update');
  });

  it.each([null, 'x', {}, { results: 'nope' }])('returns [] for %j', (payload) => {
    expect(parseDocumentBroadcastBatch(payload)).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// Broadcast subscription through a connected client
// ----------------------------------------------------------------------------

function buildHandshakeSocket(worldData: Record<string, unknown>) {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const socket = {
    connected: true,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
      return socket;
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((h) => h !== handler),
      );
      return socket;
    }),
    emit: vi.fn((event: string, ack?: (payload: unknown) => void) => {
      if (event === 'world' && typeof ack === 'function') {
        ack(worldData);
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

const WORLD_DATA = {
  userId: 'test-user-id',
  world: { id: 'w', title: 'Test World' },
  system: { id: 'dnd5e', version: '6.0.6' },
  release: { version: '14.369' },
  actors: [{ _id: ACTOR_ID, name: 'Vex', type: 'character', system: {}, items: [] }],
  scenes: [],
  items: [],
  journal: [],
  messages: [],
  combats: [{ _id: OLD_COMBAT_ID, active: true, round: 1, turn: 0, combatants: [] }],
  users: [],
  activeUsers: [],
  settings: [],
  macros: [],
  playlists: [],
  tables: [],
  folders: [],
};

async function connectWithMockSocket() {
  const { io } = await import('socket.io-client');
  const { authenticateFoundry } = await import('../auth.js');
  vi.mocked(authenticateFoundry).mockResolvedValue({
    session: 'test-session',
    userId: 'test-user-id',
  });
  const harness = buildHandshakeSocket(structuredClone(WORLD_DATA));
  vi.mocked(io).mockReturnValue(harness.socket as never);

  const client = new FoundryClient({
    baseUrl: 'http://localhost:30000',
    username: 'gm',
    password: 'secret',
  });
  const connecting = client.connect();
  await vi.waitFor(() => expect(harness.listeners.get('session')?.length).toBe(1));
  harness.fire('session', { userId: 'test-user-id' });
  await connecting;
  return { client, ...harness };
}

const combats = (client: InstanceType<typeof FoundryClient>) =>
  (client.getWorldData() as WorldData).combats as Array<{ _id: string; active?: boolean }>;

describe('modifyDocumentBatch broadcast — v14 side-effect delivery', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('applies the primary change and its side effects to the cache', async () => {
    const { client, fire } = await connectWithMockSocket();

    fire('modifyDocumentBatch', {
      results: [
        deactivateOldCombat,
        {
          type: 'Combat',
          action: 'create',
          operation: {},
          result: [{ _id: NEW_COMBAT_ID, scene: SCENE_ID, active: true, combatants: [] }],
          broadcast: true,
        },
      ],
    });

    expect(combats(client)).toEqual([
      expect.objectContaining({ _id: OLD_COMBAT_ID, active: false }),
      expect.objectContaining({ _id: NEW_COMBAT_ID, active: true }),
    ]);
  });

  it('applies an embedded entry against its parent', async () => {
    const { client, fire } = await connectWithMockSocket();

    fire('modifyDocumentBatch', {
      results: [
        {
          type: 'Item',
          action: 'create',
          operation: { parentUuid: `Actor.${ACTOR_ID}` },
          result: [{ _id: ITEM_ID, name: 'Rope', type: 'loot' }],
        },
      ],
    });

    const actor = client.getRawActor(ACTOR_ID) as { items: Array<{ _id: string }> };
    expect(actor.items.map((i) => i._id)).toEqual([ITEM_ID]);
  });

  it('ignores a malformed batch payload without touching the cache', async () => {
    const { client, fire } = await connectWithMockSocket();
    fire('modifyDocumentBatch', { results: 'nope' });
    fire('modifyDocumentBatch', null);
    expect(combats(client)).toEqual([
      expect.objectContaining({ _id: OLD_COMBAT_ID, active: true }),
    ]);
  });

  it('removes the modifyDocumentBatch listener on disconnect()', async () => {
    const { client, socket, listeners } = await connectWithMockSocket();
    const registered = socket.on.mock.calls
      .filter(([event]) => event === 'modifyDocumentBatch')
      .map(([, handler]) => handler);
    expect(registered).toHaveLength(1);

    await client.disconnect();

    expect(socket.off).toHaveBeenCalledWith('modifyDocumentBatch', registered[0]);
    expect(listeners.get('modifyDocumentBatch') ?? []).toHaveLength(0);
  });
});
