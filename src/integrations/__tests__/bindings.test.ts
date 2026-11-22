import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

async function runBinding(path: string, context: Record<string, unknown>): Promise<unknown> {
  const script = await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
  return runInNewContext(`(async () => { ${script} })()`, context);
}

describe('fixed runtime bindings', () => {
  it('compiles every Item Piles contract with the runtime strict Ajv policy', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../../modules/item-piles/manifest.json', import.meta.url), 'utf8'),
    ) as {
      operations: Array<{
        id: string;
        inputSchema: Record<string, unknown>;
        outputSchema: Record<string, unknown>;
      }>;
    };
    const ajv = new Ajv({ allErrors: true, strict: true });
    for (const operation of manifest.operations) {
      expect(
        () => ajv.compile(operation.inputSchema),
        `${operation.id} input schema`,
      ).not.toThrow();
      expect(
        () => ajv.compile(operation.outputSchema),
        `${operation.id} output schema`,
      ).not.toThrow();
    }
  });

  it('validates all Item Piles recipes and rejects undeclared or missing arguments', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../../modules/item-piles/manifest.json', import.meta.url), 'utf8'),
    ) as {
      operations: Array<{
        id: string;
        inputSchema: Record<string, unknown> & { required?: string[] };
      }>;
    };
    const recipes = JSON.parse(
      await readFile(
        new URL('../../../modules/item-piles/examples/workflows.json', import.meta.url),
        'utf8',
      ),
    ) as {
      target_id: string;
      calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
      workflows: Array<{ id: string; steps: string[] }>;
    };
    const ajv = new Ajv({ allErrors: true, strict: true });
    const validators = new Map(
      manifest.operations.map(
        (operation) =>
          [
            `module_item-piles_${operation.id}`,
            {
              validate: ajv.compile(operation.inputSchema),
              required: operation.inputSchema.required ?? [],
            },
          ] as const,
      ),
    );
    const ids = new Set(recipes.calls.map((call) => call.id));
    expect(ids.size).toBe(recipes.calls.length);
    expect([...new Set(recipes.calls.map((call) => call.name))].sort()).toEqual(
      [...validators.keys()].sort(),
    );
    for (const call of recipes.calls) {
      const { target_id, ...args } = call.arguments;
      expect(target_id).toBe(recipes.target_id);
      const contract = validators.get(call.name);
      if (!contract) {
        throw new Error(`Unknown recipe operation: ${call.name}`);
      }
      expect(
        contract.validate(args),
        `${call.id}: ${ajv.errorsText(contract.validate.errors)}`,
      ).toBe(true);
      expect(contract.validate({ ...args, arbitrary_code: 'untrusted source' })).toBe(false);
      for (const required of contract.required) {
        const missing = { ...args };
        delete missing[required];
        expect(contract.validate(missing), `${call.id} requires ${required}`).toBe(false);
      }
    }
    for (const workflow of recipes.workflows) {
      expect(workflow.steps.every((id) => ids.has(id)), workflow.id).toBe(true);
    }
    const invalid: Array<[string, Record<string, unknown>]> = [
      ['add_items', { actor_uuid: 'Actor.a', items: [{ item_uuid: 'Item.a', quantity: 0 }] }],
      [
        'add_currencies',
        { actor_uuid: 'Actor.a', currencies: [{ abbreviation: 'gp', quantity: '1d6' }] },
      ],
      ['set_attributes', { actor_uuid: 'Actor.a', attributes: { 'ownership.default': 3 } }],
      ['set_attributes', { actor_uuid: 'Actor.a', attributes: { 'system.__proto__.value': 3 } }],
      ['update_pile', { actor_uuid: 'Actor.a', settings: { macro: 'untrusted source' } }],
      ['refresh_merchant_inventory', { merchant_uuid: 'Actor.a' }],
      ['roll_item_table', { table_uuid: 'RollTable.a', rolls: '1d6' }],
    ];
    for (const [id, args] of invalid) {
      expect(validators.get(`module_item-piles_${id}`)?.validate(args), id).toBe(false);
    }
  });

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
        ready: true,
        user: { id: 'gm', isGM: true },
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
