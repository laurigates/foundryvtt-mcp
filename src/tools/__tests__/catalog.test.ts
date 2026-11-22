import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TargetConfig } from '../../config/targets.js';
import type { IntegrationTool } from '../../integrations/types.js';
import { ProviderError } from '../../providers/errors.js';
import type { FoundryProvider } from '../../providers/types.js';
import { FoundrySessionManager, type SessionIntegrations } from '../../sessions/index.js';
import { ToolCatalog } from '../catalog.js';
import * as definitions from '../definitions.js';

const managers: FoundrySessionManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
  vi.restoreAllMocks();
});

function fixture(
  id: string,
  options: {
    offline?: boolean;
    module?: boolean;
    write?: boolean;
    outputType?: string;
    stale?: boolean;
    capabilities?: string[];
  } = {},
) {
  let connected = false;
  let generation = 0;
  let stale = options.stale ?? false;
  const provider = {
    kind: 'socketio',
    capabilities: new Set(options.capabilities ?? ['core.read', 'core.cache', 'core.write']),
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
    getWorldSummary: () => ({ actors: 1, scenes: 1 }),
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
  it('keeps the legacy single-target text at content[0] and adds only metadata', async () => {
    const { catalog } = await setup(fixture('a'));
    const result = await catalog.call('get_actor_details', { actorId: 'same-id' });
    expect(result.content).toEqual([
      {
        type: 'text',
        text: `🎭 **Actor Details: Actor in a**
**Type:** character
**Level:** Unknown
**Hit Points:** Unknown/Unknown
**Armor Class:** Unknown

**Ability Scores:**
No ability scores available

**Description:** No description available.`,
      },
    ]);
    expect(result.structuredContent).toBeUndefined();
    expect(result._meta).toEqual({ target_id: 'a', world_id: 'a', session_generation: 1 });
    const schema = catalog.list().find((tool) => tool.name === 'get_actor_details')?.inputSchema;
    expect(schema?.required).toContain('actorId');
    expect(schema?.required).not.toContain('target_id');
  });

  it('preserves the refresh response and refreshes its session exactly once', async () => {
    const a = fixture('a');
    const { catalog, manager } = await setup(a);
    const previous = manager.resolve().generation;
    const result = await catalog.call('refresh_world_data', {});
    expect(result.content).toEqual([
      {
        type: 'text',
        text:
          'World data refreshed successfully.\n\n**Collection Counts:**\n' +
          '- **actors**: 1\n- **scenes**: 1',
      },
    ]);
    expect(result.structuredContent).toBeUndefined();
    expect(result._meta?.session_generation).toBeGreaterThan(previous);
    expect(a.provider.refreshWorldData).toHaveBeenCalledTimes(1);
  });

  it('lists and reads legacy resource aliases with one configured target', async () => {
    const { catalog } = await setup(fixture('a'));
    expect(catalog.listResources()).toContainEqual({
      uri: 'foundry://scenes',
      name: 'All Scenes',
      description: 'List of all scenes in the current world',
      mimeType: 'application/json',
    });
    expect(catalog.listResources().some((item) => item.uri === 'foundry://targets/a/scenes')).toBe(
      true,
    );
    const result = await catalog.readResource('foundry://scenes');
    expect(result.contents[0]?.uri).toBe('foundry://scenes');
    expect(JSON.parse(result.contents[0]?.text ?? '{}')).toMatchObject({
      scenes: [{ _id: 'same-scene', name: 'a', active: true }],
      total: 1,
    });
    expect(result._meta).toEqual({ target_id: 'a', world_id: 'a', session_generation: 1 });
    expect(catalog.listResources().some((item) => item.uri.includes('system/diagnostics'))).toBe(
      false,
    );
  });

  it('keeps aliases unavailable when a second configured target is offline', async () => {
    const { catalog } = await setup(fixture('a'), fixture('b', { offline: true }));
    expect(catalog.listResources().every((item) => item.uri.startsWith('foundry://targets/'))).toBe(
      true,
    );
    await expect(catalog.readResource('foundry://scenes')).rejects.toMatchObject({
      code: 'ambiguous_target',
    });
  });

  it('preserves MethodNotFound for unknown tool names before selecting a target', async () => {
    const { catalog } = await setup(fixture('a'), fixture('b'));
    await expect(catalog.call('no_such_tool', {})).rejects.toMatchObject({
      code: ErrorCode.MethodNotFound,
      message: expect.stringContaining('Unknown tool: no_such_tool'),
    });
  });

  it('preserves typed MCP handler errors', async () => {
    const a = fixture('a');
    const error = new McpError(ErrorCode.InvalidParams, 'Actor does not exist');
    vi.mocked(a.provider.getActor).mockRejectedValue(error);
    const { catalog } = await setup(a);
    await expect(catalog.call('get_actor_details', { actorId: 'missing' })).rejects.toBe(error);
  });

  it('classifies all core tools and blocks unclassified additions', async () => {
    const a = fixture('a', {
      write: true,
      capabilities: [
        'core.read',
        'core.cache',
        'core.write',
        'diagnostics.read',
        'compendium.read',
      ],
    });
    const existing = definitions.getAllTools();
    const template = existing[0];
    if (!template) {
      throw new Error('Expected at least one core tool');
    }
    vi.spyOn(definitions, 'getAllTools').mockReturnValue([
      ...existing,
      { ...template, name: 'unclassified_tool' },
    ]);
    const { catalog } = await setup(a);
    const listed = new Set(catalog.list().map((tool) => tool.name));
    for (const tool of existing) {
      expect(listed.has(tool.name), tool.name).toBe(true);
    }
    expect(listed.has('unclassified_tool')).toBe(false);
    const blocked = await catalog.call('unclassified_tool', {});
    expect(blocked.isError).toBe(true);
    expect(text(blocked)).toContain('unsupported_operation');
  });

  it.each(['core', 'integration', 'write'] as const)(
    'does not return or relabel a stale %s result if reconnect happens after session.run settles',
    async (kind) => {
      const a = fixture('a', { module: true, write: true });
      const { catalog, manager } = await setup(a);
      const session = manager.resolve();
      const generation = session.generation;
      const run = session.run.bind(session);
      // Model the real microtask boundary between session validation and MCP response creation.
      vi.spyOn(session, 'run').mockImplementation(async (operation, options) => {
        const result = await run(operation, options);
        await session.reconnect();
        return result;
      });
      const result =
        kind === 'core'
          ? await catalog.call('get_actor_details', { actorId: 'same-id' })
          : kind === 'integration'
            ? await catalog.call('module_item-piles_get_items', { actor_uuid: 'Actor.same' })
            : await catalog.call('delete_actor_item', {
                actorId: 'abcdefABCDEF0123',
                itemId: '0123456789abcdef',
              });
      expect(result.isError).toBe(true);
      expect(result._meta?.session_generation).toBe(generation);
      expect(text(result)).toContain(kind === 'write' ? 'outcome_unknown' : 'session_changed');
      expect(result.structuredContent).toBeUndefined();
      expect(session.generation).toBeGreaterThan(generation);
      if (kind === 'write') {
        expect(a.provider.deleteActorItem).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('rejects a resource response if its session changes before response creation', async () => {
    const { catalog, manager } = await setup(fixture('a'));
    const session = manager.resolve();
    const run = session.run.bind(session);
    vi.spyOn(session, 'run').mockImplementation(async (operation, options) => {
      const result = await run(operation, options);
      await session.reconnect();
      return result;
    });
    await expect(catalog.readResource('foundry://scenes')).rejects.toMatchObject({
      code: 'session_changed',
    });
  });

  it('rejects a reconnect before emitting a refresh result', async () => {
    const { catalog, manager } = await setup(fixture('a'));
    const session = manager.resolve();
    const refresh = session.refreshWithContext.bind(session);
    let refreshedGeneration = 0;
    vi.spyOn(session, 'refreshWithContext').mockImplementation(async () => {
      const context = await refresh();
      refreshedGeneration = context.session_generation;
      await session.reconnect();
      return context;
    });
    const result = await catalog.call('refresh_world_data', {});
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('session_changed');
    expect(result._meta?.session_generation).toBe(refreshedGeneration);
    expect(session.generation).toBeGreaterThan(refreshedGeneration);
  });

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
