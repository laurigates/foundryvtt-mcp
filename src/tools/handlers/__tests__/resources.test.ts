import { describe, expect, it, vi } from 'vitest';
import type { DiagnosticsClient } from '../../../diagnostics/client.js';
import type { FoundryClient } from '../../../foundry/client.js';
import type { WorldCombat } from '../../../foundry/types.js';
import { handleReadResource } from '../resources.js';

const COMBAT_ID = 'cccccccccccccccc';

/**
 * Stored (creation) order deliberately differs from initiative order — the
 * same fixture the #214 combat specs use:
 *   stored:           Bob (5), Alice (18), Charlie (12)
 *   initiative order: Alice (18), Charlie (12), Bob (5)
 */
const makeUnsortedCombat = (overrides: Partial<WorldCombat> = {}): WorldCombat => ({
  _id: COMBAT_ID,
  active: true,
  round: 1,
  turn: 0,
  started: true,
  combatants: [
    { _id: 'bobbobbobbobbobb', name: 'Bob', initiative: 5, hidden: false, defeated: false },
    { _id: 'alicealicealice1', name: 'Alice', initiative: 18, hidden: false, defeated: false },
    { _id: 'charliecharlie11', name: 'Charlie', initiative: 12, hidden: false, defeated: false },
  ],
  ...overrides,
});

const stubDiagnostics = () =>
  ({
    getSystemHealth: vi.fn().mockRejectedValue(new Error('no REST')),
  }) as unknown as DiagnosticsClient;

/** Reads a resource and parses the single JSON content payload. */
const readJson = async (uri: string, client: Partial<FoundryClient>) => {
  const result = await handleReadResource(
    uri,
    client as unknown as FoundryClient,
    stubDiagnostics(),
  );
  const text = result.contents[0]?.text ?? '';
  return JSON.parse(text) as Record<string, unknown>;
};

// --------------------------------------------------------------------------
// #214 follow-up: `foundry://combat` is the id-bearing companion to
// `get_combat_state`, whose ordinals are initiative-ordered. Emitting the raw
// cached `combatants` array (creation order) next to a `turn` that indexes the
// initiative order makes `combatants[turn]` — and "the Nth name I just read" —
// resolve to the WRONG combatant.
// --------------------------------------------------------------------------
describe('foundry://combat resource', () => {
  it('emits combatants in initiative order, matching the ordinals get_combat_state prints', async () => {
    const combat = makeUnsortedCombat();
    const payload = await readJson('foundry://combat', {
      getCombatState: vi.fn().mockReturnValue(combat),
    });

    const emitted = payload.combat as WorldCombat;
    expect(emitted.combatants.map((c) => c.name)).toEqual(['Alice', 'Charlie', 'Bob']);
    // `get_combat_state` prints "3. **Bob**"; combatants[2] must be Bob's id.
    expect(emitted.combatants[2]?._id).toBe('bobbobbobbobbobb');
  });

  it('resolves `turn` against the emitted combatants array', async () => {
    const combat = makeUnsortedCombat({ turn: 1 });
    const payload = await readJson('foundry://combat', {
      getCombatState: vi.fn().mockReturnValue(combat),
    });

    const emitted = payload.combat as WorldCombat;
    expect(emitted.turn).toBe(1);
    expect(emitted.combatants[emitted.turn ?? 0]?.name).toBe('Charlie');
  });

  it('keeps the other Combat document fields intact', async () => {
    const combat = makeUnsortedCombat();
    const payload = await readJson('foundry://combat', {
      getCombatState: vi.fn().mockReturnValue(combat),
    });

    const emitted = payload.combat as WorldCombat;
    expect(emitted._id).toBe(COMBAT_ID);
    expect(emitted.round).toBe(1);
    expect(emitted.active).toBe(true);
    expect(emitted.started).toBe(true);
  });

  it('does not reorder the cached combatants array', async () => {
    const combat = makeUnsortedCombat();
    await readJson('foundry://combat', { getCombatState: vi.fn().mockReturnValue(combat) });

    expect(combat.combatants.map((c) => c.name)).toEqual(['Bob', 'Alice', 'Charlie']);
  });

  it('emits a null combat when no encounter is active', async () => {
    const payload = await readJson('foundry://combat', {
      getCombatState: vi.fn().mockReturnValue(null),
    });

    expect(payload.combat).toBeNull();
  });
});
