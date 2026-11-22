import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { generatedFiles, generatePackage } from '../build.mjs';
import { metadata, legacyOperation, legacyBinding, legacyProbe } from '../src/registry.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
async function execute(source, context) {
  return runInNewContext(`(async () => {\n${source}\n})()`, context);
}
test('autonomous generation-13 package is reproducible and exposes only the original read', async () => {
  assert.deepEqual(await generatePackage(), { operations: 1, files: 3 });
  assert.deepEqual([...generatedFiles()], [...generatedFiles()]);
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  assert.equal(manifest.foundryGeneration, 13);
  assert.equal(manifest.adapterVersion, '0.1.1');
  assert.deepEqual(manifest.operations, [legacyOperation]);
  assert.deepEqual(manifest.upstream, {
    repository: 'https://github.com/foundryvtt/pf2e',
    reference: 'pf2e-7.12.2@522dec9d289c7da8b69ac0167b11ccd639871fef',
    updatedAt: '2026-04-06',
    verifiedAt: null,
  });
  assert.deepEqual(manifest.compatibility.tested, []);
  assert.equal(await readFile(new URL('../get_actor_data.js', import.meta.url), 'utf8'), legacyBinding);
  assert.equal(await readFile(new URL('../probe.js', import.meta.url), 'utf8'), legacyProbe);
});
test('original schema and unmodified source system data are preserved', async () => {
  const calls = [];
  const source = { custom: { value: 23 }, _preserved: 'raw source' };
  const actor = { documentName: 'Actor', id: 'hero', uuid: 'Actor.hero', name: 'Hero', type: 'character', toObject: () => ({ system: source }) };
  const result = plain(await execute(legacyBinding, { args: { actor_uuid: actor.uuid }, game: { system: { id: metadata.id } }, fromUuid: async uuid => { calls.push(uuid); return actor; } }));
  assert.deepEqual(result, { id: actor.id, uuid: actor.uuid, name: actor.name, type: actor.type, system: source });
  assert.deepEqual(calls, [actor.uuid]);
  assert.equal(legacyOperation.readOnly, true);
  assert.deepEqual(legacyOperation.inputSchema.required, ['actor_uuid']);
  assert.equal(legacyOperation.inputSchema.additionalProperties, false);
});
for (const [label, actor, system] of [
  ['missing Actor', null, metadata.id],
  ['wrong document', { documentName: 'Item' }, metadata.id],
  ['wrong system', { documentName: 'Actor' }, 'different-system'],
]) test(`legacy binding rejects ${label}`, async () => {
  await assert.rejects(execute(legacyBinding, { args: { actor_uuid: 'Actor.hero' }, game: { system: { id: system } }, fromUuid: async () => actor }));
});
test('probe is non-mutating and generation selection remains host-owned', async () => {
  let calls = 0;
  const context = { game: { ready: true, system: { id: metadata.id }, release: { generation: 13 } }, fromUuid: async () => { calls++; } };
  assert.equal((await execute(legacyProbe, context)).ready, true);
  context.game.ready = false;
  assert.equal((await execute(legacyProbe, context)).ready, false);
  context.game.ready = true; context.game.system.id = 'different-system';
  assert.equal((await execute(legacyProbe, context)).ready, false);
  assert.equal(calls, 0);
});
