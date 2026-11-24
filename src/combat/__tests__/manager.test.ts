import { afterEach, describe, expect, it } from 'vitest';
import type { FoundryClient } from '../../foundry/client.js';
import { CombatManager } from '../manager.js';

// The constructor ignores the client; an empty stand-in is enough.
const client = {} as unknown as FoundryClient;

describe('CombatManager.startCombat combatant defaults (#292)', () => {
  let manager: CombatManager | undefined;

  afterEach(() => {
    manager?.destroy();
    manager = undefined;
  });

  async function startWith(data: Parameters<CombatManager['startCombat']>[0][number]) {
    manager = new CombatManager(client);
    const combat = await manager.startCombat([data]);
    const combatant = combat.combatants[0];
    if (!combatant) {
      throw new Error('no combatant initialized');
    }
    return combatant;
  }

  it('keeps an AC of 0 instead of replacing it with 10', async () => {
    const combatant = await startWith({ name: 'Ooze', ac: 0 });
    expect(combatant.ac).toBe(0);
  });

  it('defaults AC to 10 only when it is absent', async () => {
    const combatant = await startWith({ name: 'Goblin' });
    expect(combatant.ac).toBe(10);
  });

  it('keeps HP with current 0 as given', async () => {
    const combatant = await startWith({ name: 'Downed', hp: { current: 0, max: 12 } });
    expect(combatant.hp).toEqual({ current: 0, max: 12 });
  });

  it('defaults HP to 1/1 only when it is absent', async () => {
    const combatant = await startWith({ name: 'Goblin' });
    expect(combatant.hp).toEqual({ current: 1, max: 1 });
  });
});
