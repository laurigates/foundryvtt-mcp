import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IntegrationManager } from '../manager.js';
import { loadIntegrations, toolName } from '../manifest.js';

const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('integration packages', () => {
  it('preserves upstream IDs and loads both families', async () => {
    expect(toolName('module', 'item-piles', 'get_items')).toBe('module_item-piles_get_items');
    const packages = await loadIntegrations(packageRoot);
    expect([...new Set(packages.map((entry) => `${entry.manifest.kind}:${entry.manifest.id}`))].sort()).toEqual([
      'module:item-piles',
      'system:dnd5e',
      'system:pf2e',
    ]);
  });
});

describe('session integration isolation', () => {
  it('publishes target-independent input, output and descriptive contracts', async () => {
    const create = (targetId: string) =>
      new IntegrationManager({
        targetId,
        packageRoot,
        execute: async () => ({ ready: true }),
      });
    const a = create('one');
    const b = create('two');
    const environment = {
      foundryVersion: '14.370',
      system: { id: 'dnd5e', version: 'test' },
      modules: [],
    };
    try {
      await Promise.all([a.reconcile(environment, 1), b.reconcile(environment, 2)]);
      expect(a.getTools()).toEqual(b.getTools());
      expect(
        a.getTools().find((tool) => tool.name === 'system_dnd5e_get_actor_data')?.outputSchema,
      ).toMatchObject({ type: 'object' });
      await a.close();
      expect(a.getTools()).toEqual([]);
      const closedStatus = a.list().find((entry) => entry.id === 'dnd5e');
      expect(closedStatus).toMatchObject({ state: 'not-ready' });
      expect(closedStatus?.operations.length).toBeGreaterThan(0);
      expect(closedStatus?.operations.every((operation) => !operation.available)).toBe(true);
      expect(b.has('system_dnd5e_get_actor_data')).toBe(true);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });

  it('selects one system and only active modules; invokes a real Python worker', async () => {
    const calls: Array<{ target: string; script: string; args: Record<string, unknown> }> = [];
    const make = (target: string) =>
      new IntegrationManager({
        targetId: target,
        packageRoot,
        execute: async (script, args) => {
          calls.push({ target, script, args });
          if (script.includes('INTEGRATION_PROBE')) {
            return { ready: true };
          }
          return {
            target,
            id: 'same-id',
            uuid: 'Actor.same-id',
            name: target,
            type: 'character',
            system: {},
          };
        },
      });
    const a = make('a');
    const b = make('b');
    try {
      await Promise.all([
        a.reconcile(
          { foundryVersion: '14.370', system: { id: 'dnd5e', version: 'test' }, modules: [] },
          1,
        ),
        b.reconcile(
          { foundryVersion: '14.370', system: { id: 'pf2e', version: 'test' }, modules: [] },
          1,
        ),
      ]);
      expect(a.has('system_dnd5e_get_actor_data')).toBe(true);
      expect(a.has('system_pf2e_get_actor_data')).toBe(false);
      expect(a.has('module_item-piles_get_items')).toBe(false);
      const [ar, br] = await Promise.all([
        a.call('system_dnd5e_get_actor_data', { actor_uuid: 'Actor.same-id' }),
        b.call('system_pf2e_get_actor_data', { actor_uuid: 'Actor.same-id' }),
      ]);
      expect(ar).toMatchObject({ target: 'a' });
      expect(br).toMatchObject({ target: 'b' });
      expect(calls.filter((call) => !call.script.includes('INTEGRATION_PROBE'))).toHaveLength(2);
      await expect(a.call('system_dnd5e_get_actor_data', { actor_uuid: '' })).rejects.toThrow();
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });

  it('allows an independent module without a local system adapter', async () => {
    const manager = new IntegrationManager({
      targetId: 'custom',
      packageRoot,
      execute: async (script) => (script.includes('INTEGRATION_PROBE') ? { ready: true } : []),
    });
    try {
      await manager.reconcile(
        {
          foundryVersion: '14.370',
          system: { id: 'custom-system', version: 'test' },
          modules: [{ id: 'item-piles', version: 'test', active: true }],
        },
        3,
      );
      expect(manager.has('module_item-piles_get_items')).toBe(true);
      expect(await manager.call('module_item-piles_get_items', { actor_uuid: 'Actor.x' })).toEqual(
        [],
      );
      await manager.reconcile(
        {
          foundryVersion: '14.370',
          system: { id: 'custom-system', version: 'test' },
          modules: [{ id: 'item-piles', version: 'test', active: false }],
        },
        4,
      );
      expect(manager.has('module_item-piles_get_items')).toBe(false);
      await expect(
        manager.call('module_item-piles_get_items', { actor_uuid: 'Actor.x' }),
      ).rejects.toThrow();
    } finally {
      await manager.close();
    }
  });

  it('reports unavailable runtimes and missing Python without claiming success', async () => {
    const manager = new IntegrationManager({
      targetId: 'offline',
      packageRoot,
      pythonExecutable: '/missing/python',
      execute: async () => ({ ready: true }),
    });
    try {
      const env = { foundryVersion: '14.370', system: { id: 'dnd5e', version: 'test' }, modules: [] };
      await manager.reconcile({ ...env, runtimeAvailable: false }, 1);
      expect(manager.getTools()).toEqual([]);
      expect(manager.list().find((entry) => entry.id === 'dnd5e')?.state).toBe('unsupported');
      await manager.reconcile({ ...env, ready: false }, 2);
      expect(manager.list().find((entry) => entry.id === 'dnd5e')?.state).toBe('not-ready');
      await manager.reconcile(env, 3);
      expect(manager.getTools()).toEqual([]);
      expect(manager.list().find((entry) => entry.id === 'dnd5e')?.state).toBe('error');
    } finally {
      await manager.close();
    }
  });

  it('removes an operation when a previously ready API disappears', async () => {
    let ready = true;
    const manager = new IntegrationManager({
      targetId: 'changed',
      packageRoot,
      execute: async () => ({ ready, reason: ready ? undefined : 'API removed' }),
    });
    try {
      await manager.reconcile(
        { foundryVersion: '14.370', system: { id: 'pf2e', version: 'test' }, modules: [] },
        1,
      );
      expect(manager.has('system_pf2e_get_actor_data')).toBe(true);
      ready = false;
      await expect(
        manager.call('system_pf2e_get_actor_data', { actor_uuid: 'Actor.x' }),
      ).rejects.toThrow('API removed');
      expect(manager.has('system_pf2e_get_actor_data')).toBe(false);
      expect(
        manager
          .list()
          .find((entry) => entry.id === 'pf2e')
          ?.operations.find((operation) => operation.name === 'system_pf2e_get_actor_data'),
      ).toMatchObject({ available: false, reason: 'API removed' });
    } finally {
      await manager.close();
    }
  });

  it('preserves provider outcome codes through Python and never resends the binding', async () => {
    let executions = 0;
    const manager = new IntegrationManager({
      targetId: 'errors',
      packageRoot,
      execute: async (script) => {
        if (script.includes('INTEGRATION_PROBE')) {
          return { ready: true };
        }
        executions += 1;
        throw Object.assign(new Error('Response lost after dispatch'), { code: 'outcome_unknown' });
      },
    });
    try {
      await manager.reconcile(
        { foundryVersion: '14.370', system: { id: 'dnd5e', version: 'test' }, modules: [] },
        1,
      );
      await expect(
        manager.call('system_dnd5e_get_actor_data', { actor_uuid: 'Actor.x' }),
      ).rejects.toMatchObject({ code: 'outcome_unknown' });
      expect(executions).toBe(1);
    } finally {
      await manager.close();
    }
  });
});
