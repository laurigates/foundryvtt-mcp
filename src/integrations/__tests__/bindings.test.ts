import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

async function runBinding(path: string, context: Record<string, unknown>): Promise<unknown> {
  const script = await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
  return runInNewContext(`(async () => { ${script} })()`, context);
}

describe('fixed runtime bindings', () => {
  it.each(['dnd5e', 'pf2e'])(
    'preserves %s system data without guessing rule APIs',
    async (system) => {
      const data = { custom: { value: 42 }, futureField: ['preserved'] };
      const result = await runBinding(`systems/${system}/get_actor_data.js`, {
        game: { system: { id: system } },
        args: { actor_uuid: 'Actor.1' },
        fromUuid: async () => ({
          documentName: 'Actor',
          id: '1',
          uuid: 'Actor.1',
          name: 'A',
          type: 'character',
          toObject: () => ({ system: data }),
        }),
      });
      expect(result).toEqual({
        id: '1',
        uuid: 'Actor.1',
        name: 'A',
        type: 'character',
        system: data,
      });
    },
  );

  it('rejects a system mismatch even if a tool was previously listed', async () => {
    await expect(
      runBinding('systems/dnd5e/get_actor_data.js', {
        game: { system: { id: 'pf2e' } },
        args: { actor_uuid: 'Actor.1' },
        fromUuid: async () => ({ documentName: 'Actor' }),
      }),
    ).rejects.toThrow('requires the dnd5e system');
  });

  it('uses the Item Piles public API and returns plain item summaries', async () => {
    const actor = { documentName: 'Actor' };
    const item = {
      id: '2',
      uuid: 'Actor.1.Item.2',
      name: 'Potion',
      type: 'consumable',
      parent: actor,
    };
    const calls: unknown[] = [];
    const result = await runBinding('modules/item-piles/get_items.js', {
      game: {
        modules: new Map([['item-piles', { active: true }]]),
        itempiles: {
          API: {
            getActorItems: (target: unknown) => {
              calls.push(target);
              return [item];
            },
            getItemQuantity: (target: unknown) => {
              expect(target).toBe(item);
              return 3;
            },
          },
        },
      },
      args: { actor_uuid: 'Actor.1' },
      fromUuid: async () => actor,
    });
    expect(calls).toEqual([actor]);
    expect(result).toEqual([
      { id: '2', uuid: 'Actor.1.Item.2', name: 'Potion', type: 'consumable', quantity: 3 },
    ]);
    expect(JSON.stringify(result)).not.toContain('parent');
  });

  it('does not equate an active module with a ready public API', async () => {
    expect(
      await runBinding('modules/item-piles/probe.js', {
        game: { ready: true, modules: new Map([['item-piles', { active: true }]]) },
        fromUuid: async () => null,
      }),
    ).toMatchObject({ ready: false });
  });
});
