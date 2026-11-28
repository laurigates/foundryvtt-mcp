import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import type { TargetConfig } from '../../config/targets.js';
import type { IntegrationTool } from '../../integrations/types.js';
import { ProviderError } from '../../providers/errors.js';
import type { FoundryProvider } from '../../providers/types.js';
import { FoundrySessionManager, type SessionIntegrations } from '../../sessions/index.js';
import { ToolCatalog } from '../catalog.js';

function targetFixture(id: string) {
  let connected = false;
  let generation = 0;
  const state = { available: true, fail: false };
  const target: TargetConfig = {
    id,
    provider: { kind: 'socketio', baseUrl: `http://${id}.test` },
    writeEnabled: false,
    integrationsEnabled: true,
  };
  const provider = {
    kind: 'socketio',
    capabilities: new Set(['runtime.execute']),
    connect: async () => {
      connected = true;
      generation++;
    },
    disconnect: async () => {
      connected = false;
      generation++;
    },
    getGeneration: () => generation,
    isConnected: () => connected,
    isWorldDataStale: () => false,
    refreshWorldData: async () => {},
    inspect: async () => ({
      world: { id, title: id },
      system: { id: 'dnd5e', version: 'fixture' },
      foundryVersion: 'fixture',
      modules: [],
      ready: true,
    }),
  } as FoundryProvider;
  const tool: IntegrationTool = {
    name: 'module_item-piles_get_items',
    description: 'Read the target inventory',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: { actor_uuid: { type: 'string' } },
      required: ['actor_uuid'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'array',
      $defs: {
        ActorSummary: {
          type: 'object',
          properties: { name: { type: 'string' }, actor_uuid: { type: 'string' } },
          required: ['name', 'actor_uuid'],
          additionalProperties: false,
        },
      },
      items: { $ref: '#/$defs/ActorSummary' },
    },
  };
  const integrations: SessionIntegrations = {
    reconcile: async () => {},
    close: async () => {},
    getTools: () => (state.available ? [tool] : []),
    list: () => [],
    has: (name) => state.available && name === tool.name,
    call: vi.fn(async (_name: string, args: Record<string, unknown>) => {
      if (state.fail) {
        throw new ProviderError('outcome_unknown', 'Response lost');
      }
      return [{ name: id, actor_uuid: args.actor_uuid }];
    }),
  };
  return { target, provider, integrations, state };
}

describe('catalog over the real MCP SDK protocol', () => {
  it('validates success output, preserves exact IDs, scopes targets and returns ordinary tool errors', async () => {
    const a = targetFixture('alpha');
    const b = targetFixture('beta');
    const fixtures = [a, b];
    const server = new Server(
      { name: 'catalog-test', version: '1' },
      { capabilities: { tools: { listChanged: true } } },
    );
    const client = new Client({ name: 'catalog-client', version: '1' });
    let notificationsEnabled = false;
    const notifications: Promise<void>[] = [];
    const manager = new FoundrySessionManager(
      fixtures.map((entry) => entry.target),
      {
        providerFactory: (config) => {
          const entry = fixtures.find(
            (candidate) =>
              config.kind === 'socketio' &&
              candidate.target.provider.kind === 'socketio' &&
              config.baseUrl === candidate.target.provider.baseUrl,
          );
          if (!entry) {
            throw new Error('Unknown provider fixture');
          }
          return entry.provider;
        },
        integrationFactory: (options) => {
          const entry = fixtures.find((candidate) => candidate.target.id === options.targetId);
          if (!entry) {
            throw new Error('Unknown integration fixture');
          }
          return entry.integrations;
        },
        monitorIntervalMs: 0,
        onChange: () => {
          if (notificationsEnabled) {
            notifications.push(server.sendToolListChanged());
          }
        },
      },
    );
    const catalog = new ToolCatalog(manager);
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: catalog.list() }));
    server.setRequestHandler(
      CallToolRequestSchema,
      async (request) =>
        (await catalog.call(request.params.name, request.params.arguments ?? {})) as CallToolResult,
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await manager.start();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      notificationsEnabled = true;
      const advertised = await client.listTools();
      const definition = advertised.tools.find(
        (tool) => tool.name === 'module_item-piles_get_items',
      );
      expect(definition?.outputSchema).toMatchObject({
        required: ['target_id', 'world_id', 'session_generation', 'result'],
      });
      expect(definition?.inputSchema.required).toContain('target_id');
      const invoke = (target_id: string) =>
        client.callTool({
          name: 'module_item-piles_get_items',
          arguments: { target_id, actor_uuid: 'Actor.shared-id' },
        });
      const [alpha, beta] = await Promise.all([invoke('alpha'), invoke('beta')]);
      expect(alpha.structuredContent).toMatchObject({
        target_id: 'alpha',
        world_id: 'alpha',
        result: [{ name: 'alpha', actor_uuid: 'Actor.shared-id' }],
      });
      expect(beta.structuredContent).toMatchObject({
        target_id: 'beta',
        world_id: 'beta',
        result: [{ name: 'beta', actor_uuid: 'Actor.shared-id' }],
      });

      // The SDK has cached the output schema. An isError result must not contain
      // structuredContent that violates that success schema.
      a.state.fail = true;
      const failed = await invoke('alpha');
      expect(failed.isError).toBe(true);
      expect(failed.structuredContent).toBeUndefined();
      expect(JSON.stringify(failed.content)).toContain('outcome_unknown');

      let received = 0;
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        received++;
      });
      b.state.available = false;
      await manager.refresh('beta');
      await Promise.all(notifications);
      expect(received).toBeGreaterThan(0);
      const unavailable = await invoke('beta');
      expect(unavailable.isError).toBe(true);
      expect(unavailable.structuredContent).toBeUndefined();
      expect(b.integrations.call).toHaveBeenCalledTimes(1);
      // Alpha still provides this public name, so losing beta does not erase it.
      expect((await client.listTools()).tools.some((tool) => tool.name === definition?.name)).toBe(
        true,
      );
    } finally {
      notificationsEnabled = false;
      await manager.close();
      await client.close();
      await server.close();
    }
  });
});
