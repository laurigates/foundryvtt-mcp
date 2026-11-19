/** One catalog owns MCP discovery, target resolution and dispatch. */
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import Ajv from 'ajv';
import type { FoundrySession, FoundrySessionManager } from '../sessions/index.js';
import type { ToolResult } from './base.js';
import { getAllTools } from './definitions.js';
import { getAllResources } from './resources.js';
import { routeResourceRequest, routeToolRequest } from './router.js';

export interface CatalogTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint: boolean; destructiveHint?: boolean };
}

const WRITES = new Set([
  'update_actor_attributes',
  'create_actor_item',
  'update_actor_item',
  'delete_actor_item',
  'next_turn',
  'end_combat',
  'set_initiative',
  'start_combat',
  'move_token',
  'apply_status_effect',
  'create_journal_entry',
]);
const DIAGNOSTICS = new Set(['get_recent_logs', 'search_logs', 'get_system_health']);
const DND5E_DEMOS = new Set(['generate_npc', 'generate_loot', 'lookup_rule']);
const CACHED = new Set([
  'get_combat_state',
  'get_chat_messages',
  'get_users',
  'search_journals',
  'get_journal',
  'search_world',
  'refresh_world_data',
  'get_world_summary',
]);
const MANAGEMENT = new Set([
  'list_targets',
  'get_target_status',
  'list_modules',
  'list_systems',
  'reconnect_target',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (isRecord(value)) {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value) ?? 'null';
}

function requiredCapability(name: string): string {
  if (WRITES.has(name)) {
    return 'core.write';
  }
  if (DIAGNOSTICS.has(name)) {
    return 'diagnostics.read';
  }
  if (name === 'search_compendium') {
    return 'compendium.read';
  }
  if (CACHED.has(name)) {
    return 'core.cache';
  }
  return 'core.read';
}

function targetArgument(args: Record<string, unknown>): string | undefined {
  const value = args.target_id;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new McpError(ErrorCode.InvalidParams, 'target_id must be a non-empty string');
  }
  return value;
}

function resourceCapability(uri: string): string {
  if (uri === 'foundry://system/diagnostics') {
    return 'diagnostics.read';
  }
  if (
    ['foundry://scenes', 'foundry://journals', 'foundry://users', 'foundry://combat'].includes(uri)
  ) {
    return 'core.cache';
  }
  return 'core.read';
}

function jsonResult(data: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

export class ToolCatalog {
  private readonly core = new Map(getAllTools().map((definition) => [definition.name, definition]));
  private readonly ajv = new Ajv({ allErrors: true, strict: false });

  constructor(private readonly sessions: FoundrySessionManager) {}

  private targetSchema(schema: Record<string, unknown>, required = false): Record<string, unknown> {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const existing = Array.isArray(schema.required) ? schema.required : [];
    return {
      ...schema,
      type: 'object',
      properties: {
        ...properties,
        target_id: {
          type: 'string',
          minLength: 1,
          description:
            'Configured Foundry target ID. Required when more than one target is configured.',
        },
      },
      required: [...existing, ...(required ? ['target_id'] : [])],
    };
  }

  private available(session: FoundrySession, name: string): boolean {
    return (
      session.state === 'ready' &&
      session.provider.isConnected() &&
      session.provider.capabilities.has(requiredCapability(name)) &&
      (!WRITES.has(name) || session.config.writeEnabled) &&
      (!DND5E_DEMOS.has(name) || session.environment?.system.id === 'dnd5e')
    );
  }

  /** Conflicting public schemas are withheld, never overwritten by the last target. */
  private integrationDefinitions(): { tools: Map<string, CatalogTool>; conflicts: Set<string> } {
    const tools = new Map<string, CatalogTool>();
    const conflicts = new Set<string>();
    for (const status of this.sessions.list()) {
      const session = this.sessions.get(status.target_id);
      if (!session || session.state !== 'ready' || !session.provider.isConnected()) {
        continue;
      }
      for (const definition of session.integrations.getTools()) {
        const tool: CatalogTool = {
          name: definition.name,
          description: definition.description,
          inputSchema: definition.inputSchema,
          outputSchema: {
            type: 'object',
            properties: {
              target_id: { type: 'string' },
              world_id: { type: ['string', 'null'] },
              session_generation: { type: 'integer' },
              result: definition.outputSchema,
            },
            required: ['target_id', 'world_id', 'session_generation', 'result'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: definition.readOnly },
        };
        if (this.core.has(tool.name) || MANAGEMENT.has(tool.name)) {
          conflicts.add(tool.name);
          continue;
        }
        const previous = tools.get(tool.name);
        if (
          previous &&
          canonical([previous.inputSchema, previous.outputSchema, previous.annotations]) !==
            canonical([tool.inputSchema, tool.outputSchema, tool.annotations])
        ) {
          conflicts.add(tool.name);
        } else {
          tools.set(tool.name, tool);
        }
      }
    }
    for (const name of conflicts) {
      tools.delete(name);
    }
    return { tools, conflicts };
  }

  list(): CatalogTool[] {
    const multiple = this.sessions.list().length > 1;
    const metadata: CatalogTool[] = [
      {
        name: 'list_targets',
        description:
          'List configured Foundry targets, connection state and capabilities. This also works while targets are offline.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      ...['get_target_status', 'list_modules', 'list_systems', 'reconnect_target'].map((name) => ({
        name,
        description:
          name === 'get_target_status'
            ? 'Inspect one target, including integration availability and connection errors.'
            : name === 'reconnect_target'
              ? 'Reconnect the configured target and recheck world identity and integration availability. Pending operations on that target are interrupted.'
              : 'List ' +
                (name === 'list_modules' ? 'module' : 'system') +
                ' integrations and their availability on a target.',
        inputSchema: this.targetSchema(
          { type: 'object', properties: {}, additionalProperties: false },
          multiple,
        ),
      })),
    ];
    const sessions = this.sessions.list().map((status) => this.sessions.get(status.target_id));
    const core = [...this.core.values()]
      .filter((definition) =>
        sessions.some((session) => session && this.available(session, definition.name)),
      )
      .map((definition) => ({
        name: definition.name,
        description: definition.description,
        inputSchema: this.targetSchema(definition.inputSchema, multiple),
        annotations: {
          readOnlyHint: !WRITES.has(definition.name),
          destructiveHint: definition.name === 'delete_actor_item',
        },
      }));
    const integrations = [...this.integrationDefinitions().tools.values()].map((definition) => ({
      ...definition,
      inputSchema: this.targetSchema(definition.inputSchema, multiple),
    }));
    return [...metadata, ...core, ...integrations];
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const targetId = targetArgument(args);
    if (name === 'list_targets') {
      this.validate({ type: 'object', properties: {}, additionalProperties: false }, args);
      return jsonResult({
        targets: this.sessions.list(),
        catalog_conflicts: [...this.integrationDefinitions().conflicts],
      });
    }
    const session = this.sessions.resolve(targetId);
    const parameters = { ...args };
    delete parameters.target_id;
    if (MANAGEMENT.has(name)) {
      this.validate({ type: 'object', properties: {}, additionalProperties: false }, parameters);
      if (name === 'get_target_status') {
        return jsonResult({ target: session.status() });
      }
      if (name === 'reconnect_target') {
        try {
          await this.sessions.reconnect(session.config.id);
          return this.attribute(session, jsonResult({ target: session.status() }));
        } catch (error) {
          return this.executionError(session, error);
        }
      }
      const kind = name === 'list_modules' ? 'module' : 'system';
      return jsonResult({
        target_id: session.config.id,
        target_state: session.state,
        integrations: session.integrations.list().filter((entry) => entry.kind === kind),
      });
    }

    const definition = this.core.get(name);
    if (definition) {
      if (WRITES.has(name) && !session.config.writeEnabled) {
        return this.error(
          session,
          'writes_disabled',
          `Writes are disabled for target ${session.config.id}`,
        );
      }
      if (!this.available(session, name)) {
        return this.error(
          session,
          'unsupported_operation',
          `Tool ${name} is unavailable on target ${session.config.id}`,
        );
      }
      this.validate(definition.inputSchema, parameters);
      try {
        if (name === 'refresh_world_data') {
          await this.sessions.refresh(session.config.id);
          return this.attribute(session, jsonResult({ refreshed: true, target: session.status() }));
        }
        const result = await session.run(
          () =>
            routeToolRequest(
              name,
              parameters,
              session.provider,
              session.diagnosticsClient,
              session.diagnosticSystem,
            ),
          { write: WRITES.has(name), refreshCache: true },
        );
        return this.attribute(session, result);
      } catch (error) {
        return this.executionError(session, error);
      }
    }

    const definitions = this.integrationDefinitions();
    if (definitions.conflicts.has(name)) {
      return this.error(
        session,
        'tool_schema_conflict',
        `Conflicting definitions for tool ${name}`,
      );
    }
    const integration = definitions.tools.get(name);
    if (!integration || !session.integrations.has(name)) {
      return this.error(
        session,
        'unsupported_operation',
        `Tool ${name} is unavailable on target ${session.config.id}`,
      );
    }
    this.validate(integration.inputSchema, parameters);
    try {
      const result = await session.run(() => session.integrations.call(name, parameters), {
        write: !integration.annotations?.readOnlyHint,
      });
      return this.attribute(session, jsonResult({ result }));
    } catch (error) {
      return this.executionError(session, error);
    }
  }

  listResources() {
    return this.sessions.list().flatMap((status) => {
      const session = this.sessions.get(status.target_id);
      if (!session || session.state !== 'ready' || !session.provider.isConnected()) {
        return [];
      }
      return getAllResources()
        .filter((resource) => session.provider.capabilities.has(resourceCapability(resource.uri)))
        .map((resource) => ({
          ...resource,
          uri:
            'foundry://targets/' +
            encodeURIComponent(status.target_id) +
            '/' +
            resource.uri.slice('foundry://'.length),
          name: `${status.target_id}: ${resource.name}`,
        }));
    });
  }

  async readResource(uri: string) {
    let targetId: string | undefined;
    let legacyUri = uri;
    if (uri.startsWith('foundry://targets/')) {
      const match = /^foundry:\/\/targets\/([^/?#]+)\/([^?#]+)$/.exec(uri);
      if (!match?.[1] || !match[2]) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid target resource URI');
      }
      try {
        targetId = decodeURIComponent(match[1]);
      } catch {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid target encoding');
      }
      legacyUri = `foundry://${match[2]}`;
    }
    const session = this.sessions.resolve(targetId);
    const resource = getAllResources().find((candidate) => candidate.uri === legacyUri);
    if (!resource) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource URI: ${uri}`);
    }
    const capability = resourceCapability(legacyUri);
    if (!session.provider.capabilities.has(capability)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Resource is unsupported on target ${session.config.id}`,
      );
    }
    const result = await session.run(
      () => routeResourceRequest(legacyUri, session.provider, session.diagnosticsClient),
      { refreshCache: true },
    );
    return {
      contents: result.contents.map((content) => ({ ...content, uri })),
      _meta: this.provenance(session),
    };
  }

  private validate(schema: object, args: Record<string, unknown>): void {
    const validate = this.ajv.compile(schema);
    if (!validate(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments: ${this.ajv.errorsText(validate.errors)}`,
      );
    }
  }

  private provenance(session: FoundrySession): Record<string, unknown> {
    return {
      target_id: session.config.id,
      world_id: session.environment?.world.id ?? null,
      session_generation: session.generation,
    };
  }

  private attribute(session: FoundrySession, result: ToolResult): ToolResult {
    const source = this.provenance(session);
    return {
      ...result,
      content: [
        {
          type: 'text',
          text:
            'Target: ' +
            session.config.id +
            ' | World: ' +
            (session.environment?.world.id ?? 'unknown'),
        },
        ...result.content,
      ],
      _meta: source,
      ...(result.structuredContent
        ? { structuredContent: { ...source, ...result.structuredContent } }
        : {}),
    };
  }

  private error(session: FoundrySession, code: string, message: string): ToolResult {
    const result = this.attribute(session, jsonResult({ error: { code, message } }));
    // SDK clients validate any structuredContent against the success output schema,
    // including errors. Error details stay in content and provenance stays in _meta.
    delete result.structuredContent;
    return { ...result, isError: true };
  }

  private executionError(session: FoundrySession, error: unknown): ToolResult {
    const code =
      isRecord(error) && typeof error.code === 'string' ? error.code : 'execution_failed';
    return this.error(session, code, error instanceof Error ? error.message : 'Operation failed');
  }
}
