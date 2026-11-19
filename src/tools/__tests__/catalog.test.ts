import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TargetConfig } from '../../config/targets.js';
import type { IntegrationTool } from '../../integrations/types.js';
import { ProviderError } from '../../providers/errors.js';
import type { FoundryProvider } from '../../providers/types.js';
import { FoundrySessionManager, type SessionIntegrations } from '../../sessions/index.js';
import { ToolCatalog } from '../catalog.js';

const managers: FoundrySessionManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
});

function fixture(
  id: string,
  options: {
    offline?: boolean;
    module?: boolean;
    write?: boolean;
    outputType?: string;
    stale?: boolean;
  } = {},
) {
  let connected = false;
  let generation = 0;
  let stale = options.stale ?? false;
  const provider = {
    kind: 'socketio',
    capabilities: new Set(['core.read', 'core.cache', 'core.write']),
    connect: async () => {
      if (options.offline) {
        throw new Error('offline');
      }
      connected = true;
      generation++;
    },
    disconnect: async () => {
      connected = false;
      generation++;
    },
    getGeneration: () => generation,
    isConnected: () => connected,
    isWorldDataStale: () => stale,
    inspect: async () => ({
      world: { id, title: id },
      system: { id: 'dnd5e', version: 'fixture' },
      foundryVersion: 'fixture',
      modules: [],
      ready: true,
    }),
    refreshWorldData: vi.fn(async () => {
      stale = false;
    }),
    getActor: vi.fn(async (actorId: string) => ({
      _id: actorId,
      name: 'Actor in ' + id,
      type: 'character',
    })),
    getScenes: () => [{ _id: 'same-scene', name: id, active: true }],
    deleteActorItem: vi.fn(async () => {}),
  } as FoundryProvider;
  const tool: IntegrationTool = {
    name: 'module_item-piles_get_items',
    description: 'Item inventory',
    inputSchema: {
      type: 'object',
      properties: { actor_uuid: { type: 'string' } },
      required: ['actor_uuid'],
      additionalProperties: false,
    },
    outputSchema: { type: options.outputType ?? 'array' },
    readOnly: true,
  };
  const integrations: SessionIntegrations = {
    reconcile: vi.fn(async () => {}),
    getTools: () => (options.module ? [tool] : []),
    list: () => [],
    has: (name) => options.module === true && name === tool.name,
    call: vi.fn(async () => [{ name: id }]),
    close: vi.fn(async () => {}),
  };
  const target: TargetConfig = {
    id,
    provider: { kind: 'socketio', baseUrl: 'http://' + id + '.test' },
    writeEnabled: options.write ?? false,
    pythonExecutable: 'python3',
    integrationTimeoutMs: 1000,
    integrationsEnabled: true,
  };
  return {
    provider,
    integrations,
    target,
    drop: () => {
      connected = false;
      generation++;
    },
  };
}

async function setup(...fixtures: ReturnType<typeof fixture>[]) {
  const manager = new FoundrySessionManager(
    fixtures.map(({ target }) => target),
    {
      providerFactory: (config) => {
        const item = fixtures.find(
          ({ target }) =>
            config.kind === 'socketio' &&
            target.provider.kind === 'socketio' &&
            target.provider.baseUrl === config.baseUrl,
        );
        if (!item) {
          throw new Error('Unknown fixture provider');
        }
        return item.provider;
      },
      integrationFactory: (options) => {
        const item = fixtures.find(({ target }) => target.id === options.targetId);
        if (!item) {
          throw new Error('Unknown fixture integrations');
        }
        return item.integrations;
      },
      monitorIntervalMs: 0,
    },
  );
  managers.push(manager);
  await manager.start();
  return { manager, catalog: new ToolCatalog(manager) };
}

const text = (result: { content: Array<{ text?: string }> }) =>
  result.content.map((entry) => entry.text ?? '').join('\n');

describe('MCP target catalog', () => {
  it('lists management tools while all destinations are offline', async () => {
    const { catalog } = await setup(fixture('a', { offline: true }));
    expect(catalog.list().map((tool) => tool.name)).toEqual([
      'list_targets',
      'get_target_status',
      'list_modules',
      'list_systems',
      'reconnect_target',
    ]);
    expect(text(await catalog.call('list_targets', {}))).toContain('error');
  });

  it('resolves the same document ID independently and attributes results', async () => {
    const { catalog } = await setup(fixture('a'), fixture('b'));
    const a = await catalog.call('get_actor_details', { target_id: 'a', actorId: 'same-id' });
    const b = await catalog.call('get_actor_details', { target_id: 'b', actorId: 'same-id' });
    expect(text(a)).toContain('Actor in a');
    expect(text(b)).toContain('Actor in b');
    expect(a._meta).toMatchObject({ target_id: 'a', world_id: 'a' });
    expect(b._meta).toMatchObject({ target_id: 'b', world_id: 'b' });
  });

  it('requires the target even when only one of two configured worlds is online', async () => {
    const { catalog } = await setup(fixture('a'), fixture('b', { offline: true }));
    await expect(catalog.call('get_actor_details', { actorId: 'same-id' })).rejects.toMatchObject({
      code: 'ambiguous_target',
    });
    expect(
      catalog.list().find((tool) => tool.name === 'get_actor_details')?.inputSchema.required,
    ).toContain('target_id');
  });

  it('uses exact integration IDs and rejects the same operation on an unsupported target', async () => {
    const a = fixture('a', { module: true });
    const b = fixture('b');
    const { catalog } = await setup(a, b);
    expect(catalog.list().some((tool) => tool.name === 'module_item-piles_get_items')).toBe(true);
    const result = await catalog.call('module_item-piles_get_items', {
      target_id: 'a',
      actor_uuid: 'Actor.same',
    });
    expect(result.structuredContent).toMatchObject({ target_id: 'a', result: [{ name: 'a' }] });
    const unsupported = await catalog.call('module_item-piles_get_items', {
      target_id: 'b',
      actor_uuid: 'Actor.same',
    });
    expect(unsupported.isError).toBe(true);
    expect(unsupported.structuredContent).toBeUndefined();
    expect(b.integrations.call).not.toHaveBeenCalled();
  });

  it('keeps a tool listed if another target still provides it after a disconnect', async () => {
    const a = fixture('a', { module: true });
    const b = fixture('b', { module: true });
    const { catalog } = await setup(a, b);
    a.drop();
    expect(catalog.list().some((tool) => tool.name === 'module_item-piles_get_items')).toBe(true);
    expect(
      (
        await catalog.call('module_item-piles_get_items', {
          target_id: 'b',
          actor_uuid: 'Actor.same',
        })
      ).isError,
    ).not.toBe(true);
  });

  it('withholds conflicting public output schemas rather than overwriting them', async () => {
    const { catalog } = await setup(
      fixture('a', { module: true }),
      fixture('b', { module: true, outputType: 'object' }),
    );
    expect(catalog.list().some((tool) => tool.name === 'module_item-piles_get_items')).toBe(false);
    expect(text(await catalog.call('list_targets', {}))).toContain('module_item-piles_get_items');
    expect(
      text(
        await catalog.call('module_item-piles_get_items', {
          target_id: 'a',
          actor_uuid: 'Actor.same',
        }),
      ),
    ).toContain('tool_schema_conflict');
  });

  it('qualifies resources and refuses ambiguous legacy aliases', async () => {
    const { catalog } = await setup(fixture('a'), fixture('b'));
    expect(
      catalog.listResources().some((resource) => resource.uri === 'foundry://targets/a/scenes'),
    ).toBe(true);
    const resource = await catalog.readResource('foundry://targets/b/scenes');
    expect(resource.contents[0]?.uri).toBe('foundry://targets/b/scenes');
    expect(resource.contents[0]?.text).toContain('"name": "b"');
    expect(resource._meta).toMatchObject({ target_id: 'b' });
    await expect(catalog.readResource('foundry://scenes')).rejects.toMatchObject({
      code: 'ambiguous_target',
    });
  });

  it('rejects unknown arguments before dispatching to an integration', async () => {
    const a = fixture('a', { module: true });
    const { catalog } = await setup(a);
    await expect(
      catalog.call('module_item-piles_get_items', {
        actor_uuid: 'Actor.same',
        script: 'untrusted',
      }),
    ).rejects.toThrow('Invalid arguments');
    expect(a.integrations.call).not.toHaveBeenCalled();
  });

  it('applies per-target writes and preserves unknown outcomes through core wrappers', async () => {
    const a = fixture('a', { write: true });
    const b = fixture('b');
    vi.mocked(a.provider.deleteActorItem).mockRejectedValue(
      new ProviderError('outcome_unknown', 'Response lost after dispatch'),
    );
    const { catalog } = await setup(a, b);
    const args = { actorId: 'abcdefABCDEF0123', itemId: '0123456789abcdef' };
    const blocked = await catalog.call('delete_actor_item', { ...args, target_id: 'b' });
    expect(text(blocked)).toContain('writes_disabled');
    expect(b.provider.deleteActorItem).not.toHaveBeenCalled();
    const unknown = await catalog.call('delete_actor_item', { ...args, target_id: 'a' });
    expect(text(unknown)).toContain('outcome_unknown');
    expect(a.provider.deleteActorItem).toHaveBeenCalledTimes(1);
  });

  it('refreshes stale data before a core read and never retries a write', async () => {
    const a = fixture('a', { stale: true });
    const { catalog } = await setup(a);
    await catalog.call('get_actor_details', { actorId: 'same' });
    expect(a.provider.refreshWorldData).toHaveBeenCalledTimes(1);
    expect(a.provider.getActor).toHaveBeenCalledTimes(1);
  });
});
