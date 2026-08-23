import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { FoundryClient } from '../../../foundry/client.js';
import type { WorldCombat } from '../../../foundry/types.js';
import { handleGetCombatState } from '../combat.js';
import {
  computeNextTurn,
  handleEndCombat,
  handleNextTurn,
  handleSetInitiative,
  handleStartCombat,
} from '../combat-mutations.js';
import { getTurnOrder } from '../combat-order.js';

const COMBAT_ID = 'cccccccccccccccc'; // 16 alphanumeric chars
const COMBATANT_ID = 'dddddddddddddddd';

/** Builds a minimal WorldCombat with `n` combatants. */
const makeCombat = (overrides: Partial<WorldCombat> = {}): WorldCombat => ({
  _id: COMBAT_ID,
  active: true,
  round: 1,
  turn: 0,
  started: true,
  combatants: [
    { _id: COMBATANT_ID, name: 'Alice', initiative: 15, hidden: false, defeated: false },
    { _id: 'eeeeeeeeeeeeeeee', name: 'Bob', initiative: 10, hidden: false, defeated: false },
  ],
  ...overrides,
});

describe('computeNextTurn', () => {
  it('advances to the next combatant mid-combat', () => {
    const combat = makeCombat({ turn: 0, round: 1 });
    expect(computeNextTurn(combat)).toEqual({ turn: 1, round: 1 });
  });

  it('wraps to turn 0 of the next round after the last combatant', () => {
    const combat = makeCombat({ turn: 1, round: 1 });
    expect(computeNextTurn(combat)).toEqual({ turn: 0, round: 2 });
  });

  it('treats a null turn as turn 0', () => {
    const combat = makeCombat({ turn: null, round: 3 });
    expect(computeNextTurn(combat)).toEqual({ turn: 1, round: 3 });
  });

  it('throws when the combat has no combatants', () => {
    const combat = makeCombat({ combatants: [] });
    expect(() => computeNextTurn(combat)).toThrow(/no combatants/);
  });

  describe('skipDefeated', () => {
    /** Combat with three combatants; defeated flags set via the `defeated` array. */
    const makeTrio = (turn: number | null, round: number, defeated: [boolean, boolean, boolean]) =>
      makeCombat({
        turn,
        round,
        combatants: [
          {
            _id: 'aaaaaaaaaaaaaaaa',
            name: 'A',
            initiative: 20,
            hidden: false,
            defeated: defeated[0],
          },
          {
            _id: 'bbbbbbbbbbbbbbbb',
            name: 'B',
            initiative: 15,
            hidden: false,
            defeated: defeated[1],
          },
          {
            _id: 'gggggggggggggggg',
            name: 'C',
            initiative: 10,
            hidden: false,
            defeated: defeated[2],
          },
        ],
      });

    it('skips a defeated mid-list combatant', () => {
      // turn 0 (A), B defeated -> should land on C (index 2)
      const combat = makeTrio(0, 1, [false, true, false]);
      expect(computeNextTurn(combat, true)).toEqual({ turn: 2, round: 1 });
    });

    it('does not skip when skipDefeated is false (regression guard)', () => {
      const combat = makeTrio(0, 1, [false, true, false]);
      expect(computeNextTurn(combat, false)).toEqual({ turn: 1, round: 1 });
    });

    it('wraps past a trailing defeated combatant into the next round', () => {
      // turn 1 (B), C defeated -> no eligible left this round -> round 2, first alive (A)
      const combat = makeTrio(1, 1, [false, false, true]);
      expect(computeNextTurn(combat, true)).toEqual({ turn: 0, round: 2 });
    });

    it('advances to the lone survivor when all but one are defeated', () => {
      // turn 0 (A), B and C defeated -> no eligible left this round -> round 2, first alive (A)
      const combat = makeTrio(0, 1, [false, true, true]);
      expect(computeNextTurn(combat, true)).toEqual({ turn: 0, round: 2 });
    });

    it('wraps the round to the next non-defeated combatant when the leader is defeated', () => {
      // turn 2 (C), A defeated -> round 2, first alive is B (index 1)
      const combat = makeTrio(2, 1, [true, false, false]);
      expect(computeNextTurn(combat, true)).toEqual({ turn: 1, round: 2 });
    });

    it('falls back to turn 0 when every combatant is defeated', () => {
      const combat = makeTrio(0, 1, [true, true, true]);
      expect(computeNextTurn(combat, true)).toEqual({ turn: 0, round: 2 });
    });
  });
});

describe('Combat mutation handlers', () => {
  const createMockClient = (opts: {
    combat?: WorldCombat | null;
    scenes?: Array<Record<string, unknown>>;
    updateCombat?: (id: string, patch: { turn?: number; round?: number }) => unknown;
    endCombat?: (id: string) => unknown;
    setInitiative?: (combatId: string, combatantId: string, initiative: number) => unknown;
    startCombat?: (
      sceneId: string,
      combatants: Array<{ tokenId: string; sceneId: string; actorId?: string }>,
    ) => unknown;
  }): FoundryClient =>
    ({
      getCombatState: vi.fn(() => opts.combat ?? null),
      getScenes: vi.fn(() => opts.scenes ?? []),
      updateCombat: vi.fn(opts.updateCombat ?? (() => ({}))),
      endCombat: vi.fn(opts.endCombat ?? (() => undefined)),
      setCombatantInitiative: vi.fn(opts.setInitiative ?? (() => ({}))),
      startCombat: vi.fn(
        opts.startCombat ??
          ((_sceneId: string, combatants: Array<unknown>) => ({
            combatId: COMBAT_ID,
            combatantCount: combatants.length,
          })),
      ),
    }) as unknown as FoundryClient;

  describe('handleNextTurn', () => {
    it('advances the active combat and reports the new round/turn/combatant', async () => {
      const client = createMockClient({ combat: makeCombat({ turn: 0, round: 1 }) });
      const result = await handleNextTurn({}, client);

      const text = result.content[0].text;
      expect(result.content[0].type).toBe('text');
      expect(text).toContain('Combat Turn Advanced');
      expect(text).toContain('**Round:** 1');
      expect(text).toContain('Bob');
      expect(client.updateCombat).toHaveBeenCalledWith(COMBAT_ID, { turn: 1, round: 1 });
    });

    it('raises McpError when there is no active combat', async () => {
      const client = createMockClient({ combat: null });
      await expect(handleNextTurn({}, client)).rejects.toThrow(McpError);
      expect(client.updateCombat).not.toHaveBeenCalled();
    });

    it('propagates the write-disabled guard error', async () => {
      const client = createMockClient({
        combat: makeCombat(),
        updateCombat: () => {
          throw new Error(
            'Write operations are disabled. Set FOUNDRY_WRITE_ENABLED=true to allow game-state mutation.',
          );
        },
      });
      await expect(handleNextTurn({}, client)).rejects.toThrow(/FOUNDRY_WRITE_ENABLED/);
    });

    it('skips a defeated combatant when skipDefeated arg is true', async () => {
      const combat = makeCombat({
        turn: 0,
        round: 1,
        combatants: [
          { _id: COMBATANT_ID, name: 'Alice', initiative: 15, hidden: false, defeated: false },
          { _id: 'eeeeeeeeeeeeeeee', name: 'Bob', initiative: 10, hidden: false, defeated: true },
          { _id: 'ffffffffffffffff', name: 'Cara', initiative: 5, hidden: false, defeated: false },
        ],
      });
      const client = createMockClient({ combat });
      await handleNextTurn({ skipDefeated: true }, client);
      // Bob (index 1) is defeated, so the turn advances to Cara (index 2).
      expect(client.updateCombat).toHaveBeenCalledWith(COMBAT_ID, { turn: 2, round: 1 });
    });

    it('falls back to the combat skipDefeated setting when no arg is given', async () => {
      const combat = makeCombat({
        turn: 0,
        round: 1,
        settings: { skipDefeated: true },
        combatants: [
          { _id: COMBATANT_ID, name: 'Alice', initiative: 15, hidden: false, defeated: false },
          { _id: 'eeeeeeeeeeeeeeee', name: 'Bob', initiative: 10, hidden: false, defeated: true },
          { _id: 'ffffffffffffffff', name: 'Cara', initiative: 5, hidden: false, defeated: false },
        ],
      });
      const client = createMockClient({ combat });
      await handleNextTurn({}, client);
      expect(client.updateCombat).toHaveBeenCalledWith(COMBAT_ID, { turn: 2, round: 1 });
    });
  });

  describe('handleStartCombat', () => {
    const SCENE_ID = 'ssssssssssssssss'.slice(0, 16);
    const TOKEN_A = 'tokenaaaaaaaaaaa';
    const TOKEN_B = 'tokenbbbbbbbbbbb';
    const makeScene = (active: boolean, tokens: Array<Record<string, unknown>>) => ({
      _id: SCENE_ID,
      name: 'Battlefield',
      active,
      tokens,
    });

    it('seeds combatants from explicit tokenIds, resolving actorId from the token', async () => {
      const startCombat = vi.fn(() => ({ combatId: COMBAT_ID, combatantCount: 1 }));
      const client = createMockClient({
        scenes: [makeScene(true, [{ _id: TOKEN_A, actorId: 'actoraaaaaaaaaaa' }])],
        startCombat,
      });
      const result = await handleStartCombat({ tokenIds: [TOKEN_A] }, client);

      expect(result.content[0].text).toContain('Combat Started');
      expect(startCombat).toHaveBeenCalledWith(SCENE_ID, [
        { tokenId: TOKEN_A, sceneId: SCENE_ID, actorId: 'actoraaaaaaaaaaa' },
      ]);
    });

    it('defaults to every token on the active scene when tokenIds is omitted', async () => {
      const startCombat = vi.fn(() => ({ combatId: COMBAT_ID, combatantCount: 2 }));
      const client = createMockClient({
        scenes: [
          makeScene(true, [{ _id: TOKEN_A, actorId: 'actoraaaaaaaaaaa' }, { _id: TOKEN_B }]),
        ],
        startCombat,
      });
      await handleStartCombat({}, client);

      expect(startCombat).toHaveBeenCalledWith(SCENE_ID, [
        { tokenId: TOKEN_A, sceneId: SCENE_ID, actorId: 'actoraaaaaaaaaaa' },
        { tokenId: TOKEN_B, sceneId: SCENE_ID, actorId: undefined },
      ]);
    });

    it('honours an explicit sceneId', async () => {
      const startCombat = vi.fn(() => ({ combatId: COMBAT_ID, combatantCount: 0 }));
      const client = createMockClient({
        scenes: [makeScene(false, []), { _id: 'othersssssssssss', name: 'Other', active: true }],
        startCombat,
      });
      await handleStartCombat({ sceneId: SCENE_ID }, client);
      expect(startCombat).toHaveBeenCalledWith(SCENE_ID, []);
    });

    it('raises McpError when no scene can be resolved', async () => {
      const client = createMockClient({ scenes: [] });
      await expect(handleStartCombat({}, client)).rejects.toThrow(McpError);
      expect(client.startCombat).not.toHaveBeenCalled();
    });

    it('raises McpError when a requested token is not on the scene', async () => {
      const client = createMockClient({ scenes: [makeScene(true, [{ _id: TOKEN_A }])] });
      await expect(handleStartCombat({ tokenIds: [TOKEN_B] }, client)).rejects.toThrow(McpError);
      expect(client.startCombat).not.toHaveBeenCalled();
    });
  });

  describe('handleEndCombat', () => {
    it('ends the active combat and reports the encounter id', async () => {
      const client = createMockClient({ combat: makeCombat() });
      const result = await handleEndCombat({}, client);

      expect(result.content[0].text).toContain('Combat Ended');
      expect(result.content[0].text).toContain(COMBAT_ID);
      expect(client.endCombat).toHaveBeenCalledWith(COMBAT_ID);
    });

    it('raises McpError when there is no active combat', async () => {
      const client = createMockClient({ combat: null });
      await expect(handleEndCombat({}, client)).rejects.toThrow(McpError);
      expect(client.endCombat).not.toHaveBeenCalled();
    });
  });

  describe('handleSetInitiative', () => {
    it('sets initiative on the active combat by default', async () => {
      const client = createMockClient({ combat: makeCombat() });
      const result = await handleSetInitiative(
        { combatantId: COMBATANT_ID, initiative: 18 },
        client,
      );

      expect(result.content[0].text).toContain('Initiative Set');
      expect(result.content[0].text).toContain('18');
      expect(client.setCombatantInitiative).toHaveBeenCalledWith(COMBAT_ID, COMBATANT_ID, 18);
    });

    it('honours an explicit combatId', async () => {
      const client = createMockClient({ combat: null });
      await handleSetInitiative(
        { combatantId: COMBATANT_ID, initiative: 5, combatId: COMBAT_ID },
        client,
      );
      expect(client.setCombatantInitiative).toHaveBeenCalledWith(COMBAT_ID, COMBATANT_ID, 5);
    });

    it('rejects a missing combatantId before reaching the client', async () => {
      const client = createMockClient({ combat: makeCombat() });
      await expect(handleSetInitiative({ combatantId: '', initiative: 5 }, client)).rejects.toThrow(
        McpError,
      );
      expect(client.setCombatantInitiative).not.toHaveBeenCalled();
    });

    it('rejects a non-finite initiative before reaching the client', async () => {
      const client = createMockClient({ combat: makeCombat() });
      await expect(
        handleSetInitiative({ combatantId: COMBATANT_ID, initiative: Number.NaN }, client),
      ).rejects.toThrow(McpError);
      expect(client.setCombatantInitiative).not.toHaveBeenCalled();
    });

    it('raises McpError when no active combat and no combatId', async () => {
      const client = createMockClient({ combat: null });
      await expect(
        handleSetInitiative({ combatantId: COMBATANT_ID, initiative: 5 }, client),
      ).rejects.toThrow(McpError);
      expect(client.setCombatantInitiative).not.toHaveBeenCalled();
    });
  });
});

// --------------------------------------------------------------------------
// Client-level: exercise the real methods with a mock socket, asserting the
// emitted modifyDocument body (mirrors actor-mutations.test.ts).
// --------------------------------------------------------------------------
describe('FoundryClient combat mutations', () => {
  type SocketEmitMock = (event: string, payload: unknown, cb: (response: unknown) => void) => void;

  const buildClient = (opts: { writeEnabled?: boolean; connected?: boolean }) => {
    const client = new FoundryClient({
      baseUrl: 'http://localhost:30000',
      writeEnabled: opts.writeEnabled ?? true,
    });
    const emit = vi.fn(((_event, payload, cb) => {
      const op = (
        payload as {
          operation?: {
            updates?: Array<Record<string, unknown>>;
            data?: Array<Record<string, unknown>>;
          };
        }
      ).operation;
      if (op?.updates) {
        cb({ result: [op.updates[0]] });
      } else if (op?.data) {
        // Echo created docs, stamping a Combat id so startCombat can chain.
        cb({ result: op.data.map((d) => ({ _id: COMBAT_ID, ...d })) });
      } else {
        cb({ result: [] });
      }
    }) as SocketEmitMock);
    if (opts.connected !== false) {
      (client as unknown as { socket: { connected: boolean; emit: SocketEmitMock } }).socket = {
        connected: true,
        emit,
      };
    }
    return { client, emit };
  };

  it('updateCombat emits a Combat update with turn/round and no parentUuid', async () => {
    const { client, emit } = buildClient({});
    await client.updateCombat(COMBAT_ID, { turn: 2, round: 3 });
    const [event, body] = emit.mock.calls[0] as unknown[] as [string, Record<string, unknown>];
    expect(event).toBe('modifyDocument');
    expect(body).toMatchObject({
      type: 'Combat',
      action: 'update',
      operation: { updates: [{ _id: COMBAT_ID, turn: 2, round: 3 }] },
    });
    expect((body.operation as Record<string, unknown>).parentUuid).toBeUndefined();
  });

  it('endCombat emits a Combat delete carrying ids', async () => {
    const { client, emit } = buildClient({});
    await client.endCombat(COMBAT_ID);
    const [, body] = emit.mock.calls[0] as unknown[] as [string, Record<string, unknown>];
    expect(body).toMatchObject({
      type: 'Combat',
      action: 'delete',
      operation: { ids: [COMBAT_ID] },
    });
  });

  it('setCombatantInitiative emits a Combatant update with parentUuid Combat.<id>', async () => {
    const { client, emit } = buildClient({});
    await client.setCombatantInitiative(COMBAT_ID, COMBATANT_ID, 12);
    const [, body] = emit.mock.calls[0] as unknown[] as [string, Record<string, unknown>];
    expect(body).toMatchObject({
      type: 'Combatant',
      action: 'update',
      operation: {
        updates: [{ _id: COMBATANT_ID, initiative: 12 }],
        parentUuid: `Combat.${COMBAT_ID}`,
      },
    });
  });

  it('startCombat creates a Combat then embedded Combatants with parentUuid', async () => {
    const SCENE_ID = 'sceneididididid1';
    const TOKEN_ID = 'tokenididididid1';
    const { client, emit } = buildClient({});
    const result = await client.startCombat(SCENE_ID, [
      { tokenId: TOKEN_ID, sceneId: SCENE_ID, actorId: 'actorididididid1' },
    ]);

    expect(result).toEqual({ combatId: COMBAT_ID, combatantCount: 1 });
    expect(emit).toHaveBeenCalledTimes(2);

    const [, combatBody] = emit.mock.calls[0] as unknown[] as [string, Record<string, unknown>];
    expect(combatBody).toMatchObject({
      type: 'Combat',
      action: 'create',
      operation: { data: [{ scene: SCENE_ID, active: true }] },
    });
    expect((combatBody.operation as Record<string, unknown>).parentUuid).toBeUndefined();

    const [, combatantBody] = emit.mock.calls[1] as unknown[] as [string, Record<string, unknown>];
    expect(combatantBody).toMatchObject({
      type: 'Combatant',
      action: 'create',
      operation: {
        data: [{ tokenId: TOKEN_ID, sceneId: SCENE_ID, actorId: 'actorididididid1' }],
        parentUuid: `Combat.${COMBAT_ID}`,
      },
    });
  });

  it('startCombat skips the Combatant create when there are no combatants', async () => {
    const SCENE_ID = 'sceneididididid1';
    const { client, emit } = buildClient({});
    const result = await client.startCombat(SCENE_ID, []);
    expect(result).toEqual({ combatId: COMBAT_ID, combatantCount: 0 });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('startCombat rejects a malformed scene id', async () => {
    const { client } = buildClient({});
    await expect(client.startCombat('short', [])).rejects.toThrow(/Invalid sceneId/);
  });

  it('startCombat rejects a malformed token id', async () => {
    const { client } = buildClient({});
    await expect(
      client.startCombat('sceneididididid1', [{ tokenId: 'short', sceneId: 'sceneididididid1' }]),
    ).rejects.toThrow(/Invalid tokenId/);
  });

  it('startCombat rejects writes when FOUNDRY_WRITE_ENABLED is false', async () => {
    const { client } = buildClient({ writeEnabled: false });
    await expect(client.startCombat('sceneididididid1', [])).rejects.toThrow(
      /FOUNDRY_WRITE_ENABLED/,
    );
  });

  it('rejects writes when FOUNDRY_WRITE_ENABLED is false', async () => {
    const { client } = buildClient({ writeEnabled: false });
    await expect(client.updateCombat(COMBAT_ID, { turn: 1 })).rejects.toThrow(
      /FOUNDRY_WRITE_ENABLED/,
    );
  });

  it('rejects writes when the Socket.IO connection is not active', async () => {
    const { client } = buildClient({ writeEnabled: true, connected: false });
    await expect(client.endCombat(COMBAT_ID)).rejects.toThrow(/Socket\.IO connection/);
  });

  it('rejects a malformed combat id', async () => {
    const { client } = buildClient({});
    await expect(client.updateCombat('short', { turn: 1 })).rejects.toThrow(/Invalid combatId/);
  });

  it('rejects a malformed combatant id', async () => {
    const { client } = buildClient({});
    await expect(client.setCombatantInitiative(COMBAT_ID, 'short', 5)).rejects.toThrow(
      /Invalid combatantId/,
    );
  });

  it('rejects a non-finite initiative at the client', async () => {
    const { client } = buildClient({});
    await expect(
      client.setCombatantInitiative(COMBAT_ID, COMBATANT_ID, Number.POSITIVE_INFINITY),
    ).rejects.toThrow(/Invalid initiative/);
  });
});

// --------------------------------------------------------------------------
// #214: `Combat#turn` indexes the INITIATIVE-sorted turn order, not the stored
// (creation) order of `combat.combatants`. The read tool (get_combat_state) and
// the write tool (next_turn) must agree on that ordering.
// --------------------------------------------------------------------------
describe('initiative-ordered turn semantics (#214)', () => {
  /**
   * Stored (creation) order deliberately differs from initiative order:
   *   stored:   Bob (5), Alice (18), Charlie (12)
   *   initiative order: Alice (18), Charlie (12), Bob (5)
   */
  const makeUnsortedCombat = (overrides: Partial<WorldCombat> = {}): WorldCombat =>
    makeCombat({
      turn: 0,
      round: 1,
      combatants: [
        { _id: 'bobbobbobbobbobb', name: 'Bob', initiative: 5, hidden: false, defeated: false },
        { _id: 'alicealicealice1', name: 'Alice', initiative: 18, hidden: false, defeated: false },
        {
          _id: 'charliecharlie11',
          name: 'Charlie',
          initiative: 12,
          hidden: false,
          defeated: false,
        },
      ],
      ...overrides,
    });

  const readCurrentName = async (combat: WorldCombat): Promise<string> => {
    const client = {
      getCombatState: vi.fn().mockReturnValue(combat),
      getRawActor: vi.fn().mockReturnValue(undefined),
    } as unknown as FoundryClient;
    const text = (await handleGetCombatState({}, client)).content[0]?.text ?? '';
    const line = text.split('\n').find((l) => l.includes('<-- CURRENT')) ?? '';
    return /\*\*(.+?)\*\*/.exec(line)?.[1] ?? '';
  };

  describe('getTurnOrder', () => {
    it('sorts by initiative descending without mutating the source array', () => {
      const combat = makeUnsortedCombat();
      const stored = combat.combatants.map((c) => c.name);

      expect(getTurnOrder(combat).map((c) => c.name)).toEqual(['Alice', 'Charlie', 'Bob']);
      expect(combat.combatants.map((c) => c.name)).toEqual(stored);
    });

    it('places un-rolled (null) initiative last and breaks ties by document id', () => {
      const combat = makeCombat({
        combatants: [
          {
            _id: 'zzzzzzzzzzzzzzzz',
            name: 'Zed',
            initiative: null,
            hidden: false,
            defeated: false,
          },
          {
            _id: 'aaaaaaaaaaaaaaaa',
            name: 'Ann',
            initiative: null,
            hidden: false,
            defeated: false,
          },
          { _id: 'mmmmmmmmmmmmmmmm', name: 'Mia', initiative: 7, hidden: false, defeated: false },
          { _id: 'bbbbbbbbbbbbbbbb', name: 'Ben', initiative: 7, hidden: false, defeated: false },
        ],
      });

      expect(getTurnOrder(combat).map((c) => c.name)).toEqual(['Ben', 'Mia', 'Ann', 'Zed']);
    });
  });

  it('computeNextTurn indexes the initiative order, not the stored order', () => {
    const combat = makeUnsortedCombat({ turn: 0 });
    // turn 0 is Alice (18); the next turn is Charlie (12) at sorted index 1.
    const next = computeNextTurn(combat);
    expect(next).toEqual({ turn: 1, round: 1 });
    expect(getTurnOrder(combat)[next.turn]?.name).toBe('Charlie');
  });

  it('computeNextTurn evaluates skipDefeated against the initiative order', () => {
    // Alice (18, DEFEATED) is the current turn; the next live combatant is
    // Charlie at sorted index 1. Indexing stored order would test Alice's
    // `defeated` flag at index 1 and wrongly skip to index 2 (Charlie's slot
    // in stored order is 2, but the current combatant there is Bob).
    const combat = makeUnsortedCombat({ turn: 0 });
    const alice = combat.combatants.find((c) => c.name === 'Alice');
    if (!alice) {
      throw new Error('fixture missing Alice');
    }
    alice.defeated = true;

    const next = computeNextTurn(combat, true);
    expect(next).toEqual({ turn: 1, round: 1 });
    expect(getTurnOrder(combat)[next.turn]?.name).toBe('Charlie');
  });

  it('computeNextTurn wraps to the first live combatant in initiative order', () => {
    // Stored order: Bob (5), Alice (18, defeated), Charlie (12).
    // Initiative order: Alice (defeated), Charlie, Bob -> first alive is Charlie (1).
    const combat = makeUnsortedCombat({ turn: 2 });
    const alice = combat.combatants.find((c) => c.name === 'Alice');
    if (!alice) {
      throw new Error('fixture missing Alice');
    }
    alice.defeated = true;

    const next = computeNextTurn(combat, true);
    expect(next).toEqual({ turn: 1, round: 2 });
    expect(getTurnOrder(combat)[next.turn]?.name).toBe('Charlie');
  });

  it('next_turn names the same combatant get_combat_state marks as CURRENT', async () => {
    const combat = makeUnsortedCombat({ turn: 0 });
    const updateCombat = vi.fn();
    const client = {
      getCombatState: vi.fn().mockReturnValue(combat),
      updateCombat,
    } as unknown as FoundryClient;

    const text = (await handleNextTurn({}, client)).content[0].text;

    // Alice (18) -> Charlie (12), NOT Alice (stored index 1).
    expect(text).toContain('**Now acting:** Charlie');
    expect(updateCombat).toHaveBeenCalledWith(COMBAT_ID, { turn: 1, round: 1 });

    // The cache then receives the write; the read tool must agree.
    combat.turn = 1;
    expect(await readCurrentName(combat)).toBe('Charlie');
  });

  it('keeps the same combatant acting after set_initiative reshuffles the turn order', async () => {
    const combat = makeUnsortedCombat({ turn: 0 });
    const alice = combat.combatants.find((c) => c.name === 'Alice');
    if (!alice) {
      throw new Error('fixture missing Alice');
    }

    // Before: order is Alice (18), Charlie (12), Bob (5) — turn 0 is Alice.
    expect(await readCurrentName(combat)).toBe('Alice');

    const setCombatantInitiative = vi.fn(() => {
      // Mirror the cache broadcast: Alice drops to the bottom of the order.
      alice.initiative = 1;
    });
    const updateCombat = vi.fn();
    const client = {
      getCombatState: vi.fn().mockReturnValue(combat),
      setCombatantInitiative,
      updateCombat,
    } as unknown as FoundryClient;

    await handleSetInitiative({ combatantId: alice._id, initiative: 1 }, client);
    expect(setCombatantInitiative).toHaveBeenCalledWith(COMBAT_ID, alice._id, 1);

    // Order is now Charlie (12), Bob (5), Alice (1). Core's `setupTurns`
    // re-finds the combatant that was acting and re-points `turn` at it, so
    // Alice — not whoever slid under index 0 — must still be acting.
    expect(getTurnOrder(combat).map((c) => c.name)).toEqual(['Charlie', 'Bob', 'Alice']);
    expect(updateCombat).toHaveBeenCalledWith(COMBAT_ID, { turn: 2 });

    combat.turn = 2;
    expect(await readCurrentName(combat)).toBe('Alice');

    updateCombat.mockClear();
    const text = (await handleNextTurn({}, client)).content[0].text;
    expect(text).toContain('**Now acting:** Charlie');
    expect(updateCombat).toHaveBeenCalledWith(COMBAT_ID, { turn: 0, round: 2 });

    combat.turn = 0;
    combat.round = 2;
    expect(await readCurrentName(combat)).toBe('Charlie');
  });
});

// --------------------------------------------------------------------------
// #214 follow-up: changing any initiative re-sorts the turn order underneath
// the stored `turn` index. FoundryVTT's `Combat#setupTurns` re-finds the
// combatant that was acting and re-points `turn` at its new index; without the
// same re-anchor here the MCP and Foundry disagree about whose turn it is.
// --------------------------------------------------------------------------
describe('set_initiative re-anchors Combat#turn', () => {
  const ALICE = 'alicealicealice1';
  const BOB = 'bobbobbobbobbobb';
  const CHARLIE = 'charliecharlie11';

  /**
   * stored: Bob (5), Alice (18), Charlie (12) — initiative: Alice, Charlie, Bob.
   *
   * Deliberately shaped the way FoundryVTT actually persists a Combat: there is
   * **no `started` field**. `Combat#started` is a client-side getter
   * (`turns.length > 0 && round > 0`); `BaseCombat.defineSchema()` never
   * declares it, so no document arriving over the `world` socket payload — nor
   * any `modifyDocument` broadcast — carries one. A fixture that invents
   * `started: true` hides a re-anchor that is dead against every real world.
   */
  const makeCombatFixture = (overrides: Partial<WorldCombat> = {}): WorldCombat => ({
    _id: COMBAT_ID,
    active: true,
    round: 1,
    turn: 0,
    combatants: [
      { _id: BOB, name: 'Bob', initiative: 5, hidden: false, defeated: false },
      { _id: ALICE, name: 'Alice', initiative: 18, hidden: false, defeated: false },
      { _id: CHARLIE, name: 'Charlie', initiative: 12, hidden: false, defeated: false },
    ],
    ...overrides,
  });

  /** Client whose `setCombatantInitiative` does NOT touch the fixture, so the
   *  re-anchor cannot rely on the cache broadcast having landed first. */
  const buildStaleCacheClient = (combat: WorldCombat) => {
    const updateCombat = vi.fn();
    const setCombatantInitiative = vi.fn();
    const client = {
      getCombatState: vi.fn().mockReturnValue(combat),
      setCombatantInitiative,
      updateCombat,
    } as unknown as FoundryClient;
    return { client, updateCombat, setCombatantInitiative };
  };

  it('re-anchors on a document with no `started` field, as FoundryVTT persists it', async () => {
    // The regression guard for the whole describe block: `started` is not part
    // of the persisted Combat schema, so reading it gates the re-anchor off on
    // every real world while fabricated fixtures stay green.
    const combat = makeCombatFixture({ turn: 0 });
    expect('started' in combat).toBe(false);

    const { client, updateCombat } = buildStaleCacheClient(combat);

    await handleSetInitiative({ combatantId: ALICE, initiative: 1 }, client);

    expect(updateCombat).toHaveBeenCalledWith(COMBAT_ID, { turn: 2 });
  });

  it('leaves `turn` alone when the combat has no combatants', async () => {
    // Derived started-ness needs a turn order to point into.
    const combat = makeCombatFixture({ turn: 0, combatants: [] });
    const { client, updateCombat } = buildStaleCacheClient(combat);

    await handleSetInitiative({ combatantId: ALICE, initiative: 1 }, client);

    expect(updateCombat).not.toHaveBeenCalled();
  });

  it('follows the acting combatant when another combatant slides under the stored turn', async () => {
    // Charlie is acting (initiative index 1). Bob jumps to 20 -> order becomes
    // Bob, Alice, Charlie, so Charlie is now index 2.
    const combat = makeCombatFixture({ turn: 1 });
    const { client, updateCombat } = buildStaleCacheClient(combat);

    await handleSetInitiative({ combatantId: BOB, initiative: 20 }, client);

    expect(updateCombat).toHaveBeenCalledWith(COMBAT_ID, { turn: 2 });
  });

  it('re-anchors from the projected order even before the cache broadcast lands', async () => {
    // The fixture is never mutated by the mocked write, so a re-anchor that
    // re-read the cache would compute the OLD index and skip the update.
    const combat = makeCombatFixture({ turn: 0 });
    const { client, updateCombat } = buildStaleCacheClient(combat);

    await handleSetInitiative({ combatantId: ALICE, initiative: 1 }, client);

    expect(updateCombat).toHaveBeenCalledWith(COMBAT_ID, { turn: 2 });
    expect(combat.combatants.find((c) => c._id === ALICE)?.initiative).toBe(18);
  });

  it('reports the still-acting combatant in the tool output', async () => {
    const combat = makeCombatFixture({ turn: 0 });
    const { client } = buildStaleCacheClient(combat);

    const text = (await handleSetInitiative({ combatantId: ALICE, initiative: 1 }, client))
      .content[0].text;

    expect(text).toContain('**Initiative Set**');
    expect(text).toContain('Alice');
    expect(text).toContain('turn 3 of 3');
  });

  it('leaves `turn` alone when the acting combatant keeps its index', async () => {
    // Alice is acting at index 0 and stays on top (18 -> 17 still beats 12).
    const combat = makeCombatFixture({ turn: 0 });
    const { client, updateCombat } = buildStaleCacheClient(combat);

    await handleSetInitiative({ combatantId: ALICE, initiative: 17 }, client);

    expect(updateCombat).not.toHaveBeenCalled();
  });

  it('leaves `turn` alone when no combatant is acting yet (turn null)', async () => {
    const combat = makeCombatFixture({ turn: null });
    const { client, updateCombat, setCombatantInitiative } = buildStaleCacheClient(combat);

    await handleSetInitiative({ combatantId: ALICE, initiative: 1 }, client);

    expect(setCombatantInitiative).toHaveBeenCalledWith(COMBAT_ID, ALICE, 1);
    expect(updateCombat).not.toHaveBeenCalled();
  });

  it('leaves `turn` alone before the encounter has started (round 0)', async () => {
    // Pre-roll setup: initiatives get assigned before anyone is acting.
    // Started-ness is derived from `round`, exactly as core derives it.
    const combat = makeCombatFixture({ round: 0, turn: 0 });
    const { client, updateCombat } = buildStaleCacheClient(combat);

    await handleSetInitiative({ combatantId: ALICE, initiative: 1 }, client);

    expect(updateCombat).not.toHaveBeenCalled();
  });

  it('leaves `turn` alone when the stored index resolves to no combatant', async () => {
    const combat = makeCombatFixture({ turn: 9 });
    const { client, updateCombat, setCombatantInitiative } = buildStaleCacheClient(combat);

    await expect(
      handleSetInitiative({ combatantId: ALICE, initiative: 1 }, client),
    ).resolves.toBeDefined();

    expect(setCombatantInitiative).toHaveBeenCalledWith(COMBAT_ID, ALICE, 1);
    expect(updateCombat).not.toHaveBeenCalled();
  });

  it('still writes the initiative when the target combatant is unknown to the cache', async () => {
    const combat = makeCombatFixture({ turn: 0 });
    const { client, updateCombat, setCombatantInitiative } = buildStaleCacheClient(combat);

    await handleSetInitiative({ combatantId: 'ffffffffffffffff', initiative: 30 }, client);

    expect(setCombatantInitiative).toHaveBeenCalledWith(COMBAT_ID, 'ffffffffffffffff', 30);
    expect(updateCombat).not.toHaveBeenCalled();
  });

  it('does not re-anchor a combat other than the active one', async () => {
    // Only the active combat is readable from the cache, so an explicit
    // `combatId` for some other encounter has no turn order to recompute.
    const combat = makeCombatFixture({ turn: 0 });
    const { client, updateCombat, setCombatantInitiative } = buildStaleCacheClient(combat);
    const otherCombatId = 'ffffffffffff0000';

    await handleSetInitiative(
      { combatantId: ALICE, initiative: 1, combatId: otherCombatId },
      client,
    );

    expect(setCombatantInitiative).toHaveBeenCalledWith(otherCombatId, ALICE, 1);
    expect(updateCombat).not.toHaveBeenCalled();
  });

  it('re-anchors when the active combat is named explicitly', async () => {
    const combat = makeCombatFixture({ turn: 0 });
    const { client, updateCombat } = buildStaleCacheClient(combat);

    await handleSetInitiative({ combatantId: ALICE, initiative: 1, combatId: COMBAT_ID }, client);

    expect(updateCombat).toHaveBeenCalledWith(COMBAT_ID, { turn: 2 });
  });
});
