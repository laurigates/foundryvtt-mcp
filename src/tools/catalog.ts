/** One catalog owns MCP discovery, target resolution and dispatch. */
import { createHash } from 'node:crypto';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import Ajv from 'ajv';
import type { FoundrySession, FoundrySessionManager } from '../sessions/index.js';
import type { SessionContext } from '../sessions/session.js';
import type { ToolResult } from './base.js';
import { getAllTools } from './definitions.js';
import { formatWorldRefreshResult } from './handlers/world.js';
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
const READS = new Set([
  'roll_dice',
  'search_actors',
  'get_actor_details',
  'search_items',
  'get_scene_info',
  'generate_npc',
  'generate_loot',
  'lookup_rule',
  'diagnose_errors',
  'get_health_status',
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

function integrationOutputSchema(
  name: string,
  resultSchema: Record<string, unknown>,
): Record<string, unknown> {
  // Embedding an anonymous schema changes the root of "#" and "#/$defs/...".
  // Give result its own resource identity instead of rewriting references, so
  // nested $id scopes and recursive references retain their original meaning.
  const digest = createHash('sha256').update(canonical([name, resultSchema])).digest('hex');
  const base = `https://schemas.foundryvtt-mcp.invalid/tools/${digest}/`;
  const declaredId = resultSchema.$id;
  const resultId =
    typeof declaredId === 'string' && declaredId && !declaredId.startsWith('#')
      ? declaredId
      : new URL(typeof declaredId === 'string' ? declaredId : '', `${base}result`).href;
  return {
    $id: `${base}response`,
    type: 'object',
    properties: {
      target_id: { type: 'string' },
      world_id: { type: ['string', 'null'] },
      session_generation: { type: 'integer' },
      result: { ...resultSchema, $id: resultId },
    },
    required: ['target_id', 'world_id', 'session_generation', 'result'],
    additionalProperties: false,
  };
}

function requiredCapability(name: string): string | undefined {
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
  // New tools must be classified explicitly before discovery or execution.
  return READS.has(name) ? 'core.read' : undefined;
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
    const capability = requiredCapability(name);
    return (
      capability !== undefined &&
      session.state === 'ready' &&
      session.provider.isConnected() &&
      session.provider.capabilities.has(capability) &&
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
          outputSchema: integrationOutputSchema(definition.name, definition.outputSchema),
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
    const definitions = this.integrationDefinitions();
    if (
      !this.core.has(name) &&
      !MANAGEMENT.has(name) &&
      !definitions.tools.has(name) &&
      !definitions.conflicts.has(name) &&
      !this.sessions.all().some((session) => session.integrations.has(name))
    ) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    const targetId = targetArgument(args);
    if (name === 'list_targets') {
      this.validate({ type: 'object', properties: {}, additionalProperties: false }, args);
      return jsonResult({
        targets: this.sessions.list(),
        catalog_conflicts: [...this.integrationDefinitions().conflicts],
      });
    }
    const session = this.sessions.resolve(targetId);
    let context = session.captureContext();
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
          context = session.captureContext();
          return this.attribute(context, jsonResult({ target: session.status() }));
        } catch (error) {
          return this.executionError(context, error);
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
          context,
          'writes_disabled',
          `Writes are disabled for target ${session.config.id}`,
        );
      }
      if (!this.available(session, name)) {
        return this.error(
          context,
          'unsupported_operation',
          `Tool ${name} is unavailable on target ${session.config.id}`,
        );
      }
      this.validate(definition.inputSchema, parameters);
      try {
        if (name === 'refresh_world_data') {
          context = await session.refreshWithContext();
          session.assertContextCurrent(context);
          return this.attribute(
            context,
            formatWorldRefreshResult(session.provider.getWorldSummary()),
          );
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
        session.assertContextCurrent(context, WRITES.has(name));
        return this.attribute(context, result);
      } catch (error) {
        return this.executionError(context, error);
      }
    }

    if (definitions.conflicts.has(name)) {
      return this.error(
        context,
        'tool_schema_conflict',
        `Conflicting definitions for tool ${name}`,
      );
    }
    const integration = definitions.tools.get(name);
    if (!integration || !session.integrations.has(name)) {
      return this.error(
        context,
        'unsupported_operation',
        `Tool ${name} is unavailable on target ${session.config.id}`,
      );
    }
    this.validate(integration.inputSchema, parameters);
    try {
      const result = await session.run(() => session.integrations.call(name, parameters), {
        write: !integration.annotations?.readOnlyHint,
      });
      session.assertContextCurrent(context, !integration.annotations?.readOnlyHint);
      return this.attribute(context, jsonResult({ ...this.provenance(context), result }));
    } catch (error) {
      return this.executionError(context, error);
    }
  }

  listResources() {
    const statuses = this.sessions.list();
    return statuses.flatMap((status) => {
      const session = this.sessions.get(status.target_id);
      if (!session || session.state !== 'ready' || !session.provider.isConnected()) {
        return [];
      }
      const available = getAllResources().filter((resource) =>
        session.provider.capabilities.has(resourceCapability(resource.uri)),
      );
      const qualified = available.map((resource) => ({
        ...resource,
        uri:
          'foundry://targets/' +
          encodeURIComponent(status.target_id) +
          '/' +
          resource.uri.slice('foundry://'.length),
        name: `${status.target_id}: ${resource.name}`,
      }));
      // Preserve resource discovery for existing single-world clients as well as reads.
      return statuses.length === 1 ? [...available, ...qualified] : qualified;
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
    const context = session.captureContext();
    const result = await session.run(
      () => routeResourceRequest(legacyUri, session.provider, session.diagnosticsClient),
      { refreshCache: true },
    );
    session.assertContextCurrent(context);
    return {
      contents: result.contents.map((content) => ({ ...content, uri })),
      _meta: this.provenance(context),
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

  private provenance(context: SessionContext): Record<string, unknown> {
    return {
      target_id: context.target_id,
      world_id: context.world_id,
      session_generation: context.session_generation,
    };
  }

  private attribute(context: SessionContext, result: ToolResult): ToolResult {
    return {
      ...result,
      // Provenance is additive: existing clients keep their content[0] and payload shape.
      _meta: { ...result._meta, ...this.provenance(context) },
    };
  }

  private error(context: SessionContext, code: string, message: string): ToolResult {
    const result = this.attribute(context, jsonResult({ error: { code, message } }));
    // SDK clients validate any structuredContent against the success output schema,
    // including errors. Error details stay in content and provenance stays in _meta.
    delete result.structuredContent;
    return { ...result, isError: true };
  }

  private executionError(context: SessionContext, error: unknown): ToolResult {
    if (error instanceof McpError) {
      throw error;
    }
    const code =
      isRecord(error) && typeof error.code === 'string' ? error.code : 'execution_failed';
    return this.error(context, code, error instanceof Error ? error.message : 'Operation failed');
  }
}
