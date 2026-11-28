import { access, readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createContractAjv } from '../ajv.js';
import { loadIntegrations } from '../manifest.js';

async function runBinding(path: string, context: Record<string, unknown>): Promise<unknown> {
  const script = await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
  return runInNewContext(`(async () => { ${script} })()`, context);
}

const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
const packages = await loadIntegrations(packageRoot);
const packageDirectories = packages.map((pkg) =>
  relative(packageRoot, pkg.root).replaceAll('\\', '/'),
);
const recipeDirectories = (
  await Promise.all(
    packageDirectories.map(async (directory) => {
      try {
        await access(new URL(`../../../${directory}/examples/workflows.json`, import.meta.url));
        return directory;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return undefined;
        }
        throw error;
      }
    }),
  )
).filter((directory): directory is string => directory !== undefined);
const systemDirectories = packages
  .filter(({ manifest }) => manifest.kind === 'system' && ['dnd5e', 'pf2e'].includes(manifest.id))
  .map(
    ({ manifest, root }) =>
      [manifest.id, relative(packageRoot, root).replaceAll('\\', '/')] as const,
  );
const itemPilesDirectories = packages
  .filter(({ manifest }) => manifest.kind === 'module' && manifest.id === 'item-piles')
  .map(({ root }) => relative(packageRoot, root).replaceAll('\\', '/'));

describe('fixed runtime bindings', () => {
  it.each(packageDirectories)(
    'compiles every %s contract with the runtime strict Ajv policy',
    async (directory) => {
      const manifest = JSON.parse(
        await readFile(new URL(`../../../${directory}/manifest.json`, import.meta.url), 'utf8'),
      ) as {
        operations: Array<{
          id: string;
          inputSchema: Record<string, unknown>;
          outputSchema: Record<string, unknown>;
        }>;
      };
      const ajv = createContractAjv();
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
    },
  );

  it.each(recipeDirectories)(
    'validates all %s recipes and rejects undeclared or missing arguments',
    async (directory) => {
      const manifest = JSON.parse(
        await readFile(new URL(`../../../${directory}/manifest.json`, import.meta.url), 'utf8'),
      ) as {
        kind: string;
        id: string;
        operations: Array<{
          id: string;
          inputSchema: Record<string, unknown> & { required?: string[] };
        }>;
      };
      const recipes = JSON.parse(
        await readFile(
          new URL(`../../../${directory}/examples/workflows.json`, import.meta.url),
          'utf8',
        ),
      ) as {
        target_id: string;
        calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
        workflows: Array<{ id: string; steps: string[] }>;
      };
      const ajv = createContractAjv();
      const validators = new Map(
        manifest.operations.map(
          (operation) =>
            [
              `${manifest.kind}_${manifest.id}_${operation.id}`,
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
        expect(
          workflow.steps.every((id) => ids.has(id)),
          workflow.id,
        ).toBe(true);
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
      if (manifest.kind === 'module' && manifest.id === 'item-piles') {
        for (const [id, args] of invalid) {
          expect(validators.get(`module_item-piles_${id}`)?.validate(args), id).toBe(false);
        }
      }
    },
  );

  it.each(systemDirectories)(
    'preserves %s system data in %s without guessing rule APIs',
    async (system, directory) => {
      const data = { custom: { value: 42 }, futureField: ['preserved'] };
      const result = await runBinding(`${directory}/get_actor_data.js`, {
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
    const directory = systemDirectories.find(([id]) => id === 'dnd5e')?.[1];
    expect(directory).toBeDefined();
    await expect(
      runBinding(`${directory}/get_actor_data.js`, {
        game: { system: { id: 'pf2e' } },
        args: { actor_uuid: 'Actor.1' },
        fromUuid: async () => ({ documentName: 'Actor' }),
      }),
    ).rejects.toThrow('requires the dnd5e system');
  });

  it.each(itemPilesDirectories)(
    'uses the %s public API and returns plain item summaries',
    async (directory) => {
      const actor = { documentName: 'Actor' };
      const item = {
        id: '2',
        uuid: 'Actor.1.Item.2',
        name: 'Potion',
        type: 'consumable',
        parent: actor,
      };
      const calls: unknown[] = [];
      const result = await runBinding(`${directory}/get_items.js`, {
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
    },
  );

  it.each(itemPilesDirectories)(
    'does not equate an active %s module with a ready public API',
    async (directory) => {
      expect(
        await runBinding(`${directory}/probe.js`, {
          game: { ready: true, modules: new Map([['item-piles', { active: true }]]) },
          fromUuid: async () => null,
        }),
      ).toMatchObject({ ready: false });
    },
  );
});
