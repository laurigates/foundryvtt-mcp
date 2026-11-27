import { operations as actors } from './actors.mjs';
import { operations as activities } from './activities.mjs';
export { createRuntime } from './runtime.mjs';

// Keep the original public schema and standalone files unchanged.
export const legacyOperation = {
  id: 'get_actor_data',
  description: 'Read an Actor document and its unmodified dnd5e system data. Does not calculate game rules or roll dice.',
  inputSchema: { type: 'object', properties: { actor_uuid: { type: 'string', minLength: 1, pattern: '^\\S+$', description: 'Actor UUID in the selected target world.' } }, required: ['actor_uuid'], additionalProperties: false },
  outputSchema: { type: 'object', properties: { id: { type: 'string' }, uuid: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, system: { type: 'object', additionalProperties: true } }, required: ['id', 'uuid', 'name', 'type', 'system'], additionalProperties: true },
  binding: 'get_actor_data.js', probe: 'probe.js', readOnly: true,
};

export const operations = Object.freeze([...actors, ...activities].sort((a, b) => a.id.localeCompare(b.id)));
export const metadata = Object.freeze({
  schemaVersion: 1, protocolVersion: 1, kind: 'system', foundryGeneration: 14, id: 'dnd5e', adapterVersion: '0.2.0',
  updatedAt: '2026-11-22', entrypoint: 'adapter.py', status: 'experimental',
  upstream: { repository: 'https://github.com/foundryvtt/dnd5e', reference: 'release-6.1.1@bc1b2c921e2f306dc5079f8de883ad64607118a6', updatedAt: '2026-11-16', verifiedAt: null },
  // Per-operation gates preserve the legacy raw Actor-data operation.
  compatibility: { foundryVersions: ['14'], integrationVersions: [], tested: [] },
});
