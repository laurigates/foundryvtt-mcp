import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { FoundryClient } from '../../../foundry/client.js';
import type { WorldCombat } from '../../../foundry/types.js';
import {
  computeNextTurn,
  handleEndCombat,
  handleNextTurn,
  handleSetInitiative,
} from '../combat-mutations.js';

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
});

describe('Combat mutation handlers', () => {
  const createMockClient = (opts: {
    combat?: WorldCombat | null;
    updateCombat?: (id: string, patch: { turn?: number; round?: number }) => unknown;
    endCombat?: (id: string) => unknown;
    setInitiative?: (combatId: string, combatantId: string, initiative: number) => unknown;
  }): FoundryClient =>
    ({
      getCombatState: vi.fn(() => opts.combat ?? null),
      updateCombat: vi.fn(opts.updateCombat ?? (() => ({}))),
      endCombat: vi.fn(opts.endCombat ?? (() => undefined)),
      setCombatantInitiative: vi.fn(opts.setInitiative ?? (() => ({}))),
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
      const op = (payload as { operation?: { updates?: Array<Record<string, unknown>> } })
        .operation;
      cb({ result: op?.updates ? [op.updates[0]] : [] });
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
