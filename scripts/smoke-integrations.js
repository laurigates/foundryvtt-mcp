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
const worker = new PythonWorker({
  targetId: 'packed-smoke',
  generation: 1,
  packageRoot,
  executable: process.env.FOUNDRY_PYTHON_EXECUTABLE || 'python3',
  timeoutMs: 5000,
  invoke: async (request) => {
    assert.equal(request.integration, 'system:dnd5e');
    assert.equal(request.operation, 'get_actor_data');
    assert.equal(request.arguments.actor_uuid, actor.uuid);
    assert.equal(request.callToken, 'packed-smoke-token');
    return actor;
  },
});
try {
  await worker.start();
  await worker.load('system:dnd5e', join(packageRoot, 'systems/dnd5e'), 'adapter.py');
  const result = await worker.call('system:dnd5e', 'get_actor_data', { actor_uuid: actor.uuid }, 'packed-smoke-token');
  assert.deepEqual(result, actor);
  console.log('Integration smoke passed: package files, real Python worker, and bidirectional callback. No live Foundry request was made.');
} finally {
  await worker.close();
}
