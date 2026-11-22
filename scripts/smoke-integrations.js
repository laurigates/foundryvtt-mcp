#!/usr/bin/env node
/** Offline smoke: real packaged Python process, manifest/binding files, and callback protocol. */
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = process.argv[2] ? resolve(process.argv[2]) : sourceRoot;
const { loadIntegrations } = await import(pathToFileURL(join(packageRoot, 'dist/integrations/manifest.js')).href);
const { PythonWorker } = await import(pathToFileURL(join(packageRoot, 'dist/integrations/python-worker.js')).href);
const integrations = await loadIntegrations(packageRoot);
for (const key of ['system:dnd5e', 'system:pf2e', 'module:item-piles']) {
  assert(integrations.some(({ manifest }) => manifest.kind + ':' + manifest.id === key), 'Missing package: ' + key);
}
const actor = { id: 'same-actor', uuid: 'Actor.same-actor', name: 'Packed fixture', type: 'character', system: {} };
const item = { id: 'same-item', uuid: 'Actor.same-actor.Item.same-item', name: 'Packed item', type: 'loot', quantity: 1 };
const itemPiles = integrations.find(({ manifest }) => manifest.kind === 'module' && manifest.id === 'item-piles');
assert.equal(itemPiles?.manifest.operations.find(({ id }) => id === 'get_items')?.readOnly, true);
assert.equal(itemPiles?.manifest.operations.find(({ id }) => id === 'transfer_items')?.readOnly, false);
const fixtures = new Map([
  ['packed-system-token', {
    integration: 'system:dnd5e', operation: 'get_actor_data',
    arguments: { actor_uuid: actor.uuid }, result: actor,
  }],
  ['packed-items-read-token', {
    integration: 'module:item-piles', operation: 'get_items',
    arguments: { actor_uuid: actor.uuid }, result: [item],
  }],
  ['packed-items-write-token', {
    integration: 'module:item-piles', operation: 'transfer_items',
    arguments: {
      source_uuid: actor.uuid, target_uuid: 'Actor.destination',
      items: [{ item_id: item.id, quantity: 1 }],
    },
    result: [{ item, quantity: 1 }],
  }],
]);
const pending = new Map(fixtures);
const worker = new PythonWorker({
  targetId: 'packed-smoke',
  generation: 1,
  packageRoot,
  executable: process.env.FOUNDRY_PYTHON_EXECUTABLE || 'python3',
  timeoutMs: 5000,
  invoke: async (request) => {
    const fixture = pending.get(request.callToken);
    assert(fixture, 'Unknown or repeated callback token');
    assert.equal(request.integration, fixture.integration);
    assert.equal(request.operation, fixture.operation);
    assert.deepEqual(request.arguments, fixture.arguments);
    pending.delete(request.callToken);
    return fixture.result;
  },
});
try {
  await worker.start();
  await worker.load('system:dnd5e', join(packageRoot, 'systems/dnd5e'), 'adapter.py');
  await worker.load('module:item-piles', join(packageRoot, 'modules/item-piles'), 'adapter.py');
  for (const [token, fixture] of fixtures) {
    const result = await worker.call(fixture.integration, fixture.operation, fixture.arguments, token);
    assert.deepEqual(result, fixture.result);
  }
  assert.equal(pending.size, 0);
  console.log('Integration smoke passed: package files, real Python worker, system reads and Item Piles read/write callbacks. Provider execution was local and fake; no live Foundry request was made.');
} finally {
  await worker.close();
}
