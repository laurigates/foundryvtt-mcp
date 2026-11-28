#!/usr/bin/env node
/** Offline smoke: packaged files, strict contracts, and real Python callback transport.
 * Runtime bindings are not executed against Foundry; callback results below are transport fixtures.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = process.argv[2] ? resolve(process.argv[2]) : sourceRoot;
const requirePackage = createRequire(join(packageRoot, 'package.json'));
const Ajv = requirePackage('ajv').default;
const { loadIntegrations } = await import(
  pathToFileURL(join(packageRoot, 'dist/integrations/manifest.js')).href
);
const { PythonWorker } = await import(
  pathToFileURL(join(packageRoot, 'dist/integrations/python-worker.js')).href
);
const integrations = await loadIntegrations(packageRoot);

// This is a packaging assertion for the distributed examples, not a discovery registry.
// All additional copied packages are checked by the generic loop below as well.
for (const key of ['system:dnd5e', 'system:pf2e', 'module:item-piles']) {
  for (const generation of [13, 14]) {
    assert(
      integrations.some(
        ({ manifest }) =>
          `${manifest.kind}:${manifest.id}` === key && manifest.foundryGeneration === generation,
      ),
      `Missing package: ${key}/${generation}`,
    );
  }
}

let callbackCount = 0;
let schemaCount = 0;
let sessionGeneration = 0;
for (const integration of integrations) {
  const { manifest, root } = integration;
  const identity = `${manifest.kind}:${manifest.id}`;
  const ajv = new Ajv({ allErrors: true, strict: true });
  for (const operation of manifest.operations) {
    ajv.compile(operation.inputSchema);
    ajv.compile(operation.outputSchema);
    schemaCount += 2;
  }
  let recipes;
  try {
    recipes = JSON.parse(await readFile(join(root, 'examples/workflows.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const fixtures = new Map();
  for (const readOnly of [true, false]) {
    const operation = manifest.operations.find(
      (candidate) =>
        candidate.readOnly === readOnly &&
        recipes?.calls?.some(
          (call) => call.name === `${manifest.kind}_${manifest.id}_${candidate.id}`,
        ),
    );
    if (!operation) {
      continue; // Recipes are optional for a manually copied package.
    }
    const recipe = recipes.calls.find(
      (call) => call.name === `${manifest.kind}_${manifest.id}_${operation.id}`,
    );
    const { target_id, ...arguments_ } = recipe.arguments;
    assert.equal(target_id, recipes.target_id);
    const validate = ajv.compile(operation.inputSchema);
    assert(
      validate(arguments_),
      `${identity}/${manifest.foundryGeneration} recipe: ${ajv.errorsText(validate.errors)}`,
    );
    const token = `${identity}:${manifest.foundryGeneration ?? 'flat'}:${operation.id}`;
    fixtures.set(token, {
      integration: identity,
      operation: operation.id,
      arguments: arguments_,
      result: { transport_fixture: token },
    });
  }

  const pending = new Map(fixtures);
  // Each variant is tested in a fresh target/session worker. Production never loads
  // two variants of one identity or two active systems into a target's worker.
  const worker = new PythonWorker({
    targetId: 'packed-smoke',
    generation: ++sessionGeneration,
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
      callbackCount++;
      return fixture.result;
    },
  });
  try {
    await worker.start();
    await worker.load(identity, root, manifest.entrypoint, manifest.foundryGeneration);
    for (const [token, fixture] of fixtures) {
      const result = await worker.call(
        fixture.integration,
        fixture.operation,
        fixture.arguments,
        token,
      );
      assert.deepEqual(result, fixture.result);
    }
    assert.equal(pending.size, 0);
  } finally {
    await worker.close();
  }
}
assert(
  callbackCount >= 10,
  'Bundled generation variants did not exercise their read/write callback recipes',
);
console.log(
  `Integration smoke passed: ${integrations.length} independent packages, ${schemaCount} strict schemas, ${callbackCount} real Python callbacks. Provider results were local transport fixtures; no live Foundry request or compatibility test was performed.`,
);
