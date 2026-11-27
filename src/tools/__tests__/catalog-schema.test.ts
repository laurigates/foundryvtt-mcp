import { describe, expect, it } from 'vitest';
import { createContractAjv } from '../../integrations/ajv.js';
import type { FoundrySession, FoundrySessionManager } from '../../sessions/index.js';
import { ToolCatalog } from '../catalog.js';

function catalogFor(schemas: Record<string, unknown>[]): ToolCatalog {
  const sessions = schemas.map(
    (outputSchema, index) =>
      ({
        state: 'ready',
        config: {
          id: String(index),
          provider: { kind: 'socketio', baseUrl: `http://${index}.test` },
          writeEnabled: false,
          pythonExecutable: 'python3',
          integrationTimeoutMs: 1000,
          integrationsEnabled: true,
        },
        provider: { isConnected: () => true, capabilities: new Set<string>() },
        integrations: {
          getTools: () => [
            {
              name: 'module_schema_read',
              description: 'Schema fixture',
              readOnly: true,
              inputSchema: { type: 'object', properties: {} },
              outputSchema,
            },
          ],
        },
      }) as FoundrySession,
  );
  return new ToolCatalog({
    list: () => sessions.map((_, index) => ({ target_id: String(index) })),
    get: (id: string) => sessions[Number(id)],
  } as FoundrySessionManager);
}

function wrapped(value: unknown) {
  return { target_id: '0', world_id: 'world', session_generation: 1, result: value };
}

const localReference: Record<string, unknown> = {
  type: 'object',
  $defs: { Value: { type: 'integer' } },
  properties: { value: { $ref: '#/$defs/Value' } },
  required: ['value'],
  additionalProperties: false,
};

describe('integration output schema resources', () => {
  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['empty fragment', '#'],
    ['named fragment', '#root'],
    ['relative', 'schemas/output.json'],
    ['absolute', 'https://example.invalid/integration/output.json'],
  ])('preserves root-local references with an %s ID', (_name, id) => {
    const original = id === undefined ? localReference : { ...localReference, $id: id };
    const before = JSON.stringify(original);
    const definition = catalogFor([original])
      .list()
      .find((tool) => tool.name === 'module_schema_read');
    expect(definition?.outputSchema).toBeDefined();
    const validate = createContractAjv().compile(definition?.outputSchema ?? {});
    expect(validate(wrapped({ value: 4 }))).toBe(true);
    expect(validate(wrapped({ value: 'wrong' }))).toBe(false);
    expect(JSON.stringify(original)).toBe(before);
  });

  it('keeps recursive root references inside result', () => {
    const recursive = {
      type: 'object',
      properties: {
        value: { type: 'integer' },
        next: { anyOf: [{ type: 'null' }, { $ref: '#' }] },
      },
      required: ['value', 'next'],
      additionalProperties: false,
    };
    const definition = catalogFor([recursive])
      .list()
      .find((tool) => tool.name === 'module_schema_read');
    const validate = createContractAjv().compile(definition?.outputSchema ?? {});
    expect(validate(wrapped({ value: 1, next: { value: 2, next: null } }))).toBe(true);
    expect(validate(wrapped({ value: 1, next: { value: 'wrong', next: null } }))).toBe(false);
  });

  it('preserves nested resource IDs and their own local-reference scope', () => {
    const nested = {
      $id: 'root/schema.json',
      type: 'object',
      definitions: {
        Child: {
          $id: 'parts/child.json',
          type: 'object',
          $defs: { Label: { type: 'string' } },
          properties: { label: { $ref: '#/$defs/Label' } },
          required: ['label'],
          additionalProperties: false,
        },
      },
      properties: { child: { $ref: 'parts/child.json' } },
      required: ['child'],
      additionalProperties: false,
    };
    const definition = catalogFor([nested])
      .list()
      .find((tool) => tool.name === 'module_schema_read');
    const validate = createContractAjv().compile(definition?.outputSchema ?? {});
    expect(validate(wrapped({ child: { label: 'valid' } }))).toBe(true);
    expect(validate(wrapped({ child: { label: 7 } }))).toBe(false);
  });

  it('uses the same resource identity for equivalent schemas across targets', () => {
    const reordered = {
      additionalProperties: false,
      required: ['value'],
      properties: { value: { $ref: '#/$defs/Value' } },
      $defs: { Value: { type: 'integer' } },
      type: 'object',
    };
    const tools = catalogFor([localReference, reordered])
      .list()
      .filter((tool) => tool.name === 'module_schema_read');
    expect(tools).toHaveLength(1);
    expect(tools[0].outputSchema).toEqual(
      catalogFor([localReference])
        .list()
        .find((tool) => tool.name === 'module_schema_read')?.outputSchema,
    );
  });
});
