import { operations as reads } from './reads.mjs';
import { operations as checks } from './checks.mjs';
import { operations as mutations } from './mutations.mjs';
export { createRuntime } from './runtime.mjs';

// Preserve the pre-existing read contract and capability-only binding verbatim.
export const legacyBinding = 'const actor = await fromUuid(args.actor_uuid);\nif (!actor || actor.documentName !== "Actor") throw new Error("Actor UUID does not resolve to an Actor");\nif (game.system.id !== "pf2e") throw new Error("This operation requires the pf2e system");\nconst data = actor.toObject();\nreturn {id: actor.id, uuid: actor.uuid, name: actor.name, type: actor.type, system: data.system ?? {}};\n';
export const legacyProbe = '// INTEGRATION_PROBE: no state changes and no assumption about skill/roll API signatures.\nconst ready = Boolean(game.ready && game.system.id === "pf2e" && typeof fromUuid === "function");\nreturn {ready, reason: ready ? undefined : "The pf2e runtime is not ready"};\n';
const legacy = {
  id: 'get_actor_data', readOnly: true, requirements: [], handler: () => {},
  description: 'Read an Actor document and its unmodified pf2e system data. Does not calculate game rules or roll dice.',
  inputSchema: { type: 'object', properties: { actor_uuid: { type: 'string', minLength: 1, pattern: '^\\S+$',
    description: 'Actor UUID in the selected target world.' } }, required: ['actor_uuid'], additionalProperties: false },
  outputSchema: { type: 'object', properties: { id: { type: 'string' }, uuid: { type: 'string' },
    name: { type: 'string' }, type: { type: 'string' }, system: { type: 'object', additionalProperties: true } },
    required: ['id', 'uuid', 'name', 'type', 'system'], additionalProperties: true },
};
export const operations = Object.freeze([legacy, ...reads, ...checks, ...mutations].sort((a, b) => a.id.localeCompare(b.id)));
export const metadata = Object.freeze({
  schemaVersion: 1, protocolVersion: 1, kind: 'system', foundryGeneration: 14, id: 'pf2e',
  adapterVersion: '0.2.0', updatedAt: '2026-11-22', entrypoint: 'adapter.py', status: 'experimental',
  upstream: { repository: 'https://github.com/foundryvtt/pf2e',
    reference: 'pf2e-8.7.1@397f125aea87e6d6fa36e878c9c07d0e672826cf', updatedAt: '2026-11-17', verifiedAt: null },
  compatibility: { foundryVersions: [], integrationVersions: [], tested: [] },
});
