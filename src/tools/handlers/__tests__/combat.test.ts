/**
 * @fileoverview Unit tests for combat handler — get_combat_state
 */

import { describe, expect, it, vi } from 'vitest';
import type { FoundryClient } from '../../../foundry/client.js';
import type { WorldActor, WorldCombat } from '../../../foundry/types.js';
import { handleGetCombatState } from '../combat.js';

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]?.text ?? '';
}

type Combatant = WorldCombat['combatants'][number];

function buildCombatant(overrides: Partial<Combatant> = {}): Combatant {
  return {
    _id: 'c1',
    name: 'Goblin',
    initiative: 10,
    hidden: false,
    defeated: false,
    ...overrides,
  };
}

function buildCombat(overrides: Partial<WorldCombat> = {}): WorldCombat {
  return {
    _id: 'combat-1',
    active: true,
    round: 1,
    turn: 0,
    started: true,
    combatants: [],
    ...overrides,
  };
}

describe('handleGetCombatState', () => {
  it('returns "No active combat encounter." when no combat exists', async () => {
    const client = {
      getCombatState: vi.fn().mockReturnValue(null),
    } as unknown as FoundryClient;

    const result = await handleGetCombatState({}, client);
    const text = getText(result);

    expect(text).toBe('No active combat encounter.');
    expect(client.getCombatState).toHaveBeenCalled();
  });

  it('formats active combat with combatants sorted by initiative desc', async () => {
    const combat = buildCombat({
      round: 3,
      turn: 0,
      combatants: [
        buildCombatant({ _id: 'a', name: 'Bob', initiative: 5 }),
        buildCombatant({ _id: 'b', name: 'Alice', initiative: 18 }),
        buildCombatant({ _id: 'c', name: 'Charlie', initiative: 12 }),
      ],
    });
    const client = {
      getCombatState: vi.fn().mockReturnValue(combat),
      getRawActor: vi.fn().mockReturnValue(undefined),
    } as unknown as FoundryClient;

    const result = await handleGetCombatState({}, client);
    const text = getText(result);

    expect(text).toContain('Round 3');
    // Alice (init 18) comes first
    const aliceIdx = text.indexOf('Alice');
    const charlieIdx = text.indexOf('Charlie');
    const bobIdx = text.indexOf('Bob');
    expect(aliceIdx).toBeGreaterThan(-1);
    expect(aliceIdx).toBeLessThan(charlieIdx);
    expect(charlieIdx).toBeLessThan(bobIdx);
    expect(text).toContain('1. [18] **Alice**');
    expect(text).toContain('2. [12] **Charlie**');
    expect(text).toContain('3. [5] **Bob**');
    // turn 0 corresponds to the first combatant by sorted order (Alice)
    expect(text).toMatch(/1\. \[18\] \*\*Alice\*\*.*<-- CURRENT/);
  });

  it('renders "?" for null initiative', async () => {
    const combat = buildCombat({
      combatants: [buildCombatant({ name: 'Sneaky', initiative: null })],
    });
    const client = {
      getCombatState: vi.fn().mockReturnValue(combat),
      getRawActor: vi.fn().mockReturnValue(undefined),
    } as unknown as FoundryClient;

    const result = await handleGetCombatState({}, client);
    const text = getText(result);

    expect(text).toContain('[?] **Sneaky**');
  });

  it('marks defeated and hidden combatants with status flags', async () => {
    const combat = buildCombat({
      combatants: [
        buildCombatant({ name: 'Fallen', initiative: 10, defeated: true }),
        buildCombatant({ name: 'Lurker', initiative: 8, hidden: true }),
      ],
    });
    const client = {
      getCombatState: vi.fn().mockReturnValue(combat),
      getRawActor: vi.fn().mockReturnValue(undefined),
    } as unknown as FoundryClient;

    const result = await handleGetCombatState({}, client);
    const text = getText(result);

    expect(text).toContain('Fallen');
    expect(text).toContain('[DEFEATED]');
    expect(text).toContain('Lurker');
    expect(text).toContain('[HIDDEN]');
  });

  it('appends HP/AC from raw actor when actorId resolves', async () => {
    const combat = buildCombat({
      combatants: [buildCombatant({ name: 'Orc', initiative: 12, actorId: 'actor-99' })],
    });
    const rawActor: WorldActor = {
      _id: 'actor-99',
      name: 'Orc',
      type: 'npc',
      system: {
        attributes: {
          hp: { value: 12, max: 20 },
          ac: { value: 14 },
        },
      },
    };
    const client = {
      getCombatState: vi.fn().mockReturnValue(combat),
      getRawActor: vi.fn().mockReturnValue(rawActor),
    } as unknown as FoundryClient;

    const result = await handleGetCombatState({}, client);
    const text = getText(result);

    expect(client.getRawActor).toHaveBeenCalledWith('actor-99');
    expect(text).toContain('HP: 12/20');
    expect(text).toContain('AC: 14');
  });

  it('omits HP/AC when raw actor lookup returns undefined', async () => {
    const combat = buildCombat({
      combatants: [buildCombatant({ name: 'Ghost', initiative: 7, actorId: 'missing-id' })],
    });
    const client = {
      getCombatState: vi.fn().mockReturnValue(combat),
      getRawActor: vi.fn().mockReturnValue(undefined),
    } as unknown as FoundryClient;

    const result = await handleGetCombatState({}, client);
    const text = getText(result);

    expect(text).toContain('Ghost');
    expect(text).not.toContain('HP:');
    expect(text).not.toContain('AC:');
  });

  it('handles empty combatant list gracefully', async () => {
    const combat = buildCombat({ round: 2, combatants: [] });
    const client = {
      getCombatState: vi.fn().mockReturnValue(combat),
      getRawActor: vi.fn().mockReturnValue(undefined),
    } as unknown as FoundryClient;

    const result = await handleGetCombatState({}, client);
    const text = getText(result);

    expect(text).toContain('Round 2');
  });
});
