#!/usr/bin/env node
/** Offline smoke: packaged files, strict contracts and recipe coverage.
 * Bindings and probes are compiled, never executed: no Foundry runtime is available here.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validatePackageFiles } from './integration-packages.mjs';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = process.argv[2] ? resolve(process.argv[2]) : sourceRoot;
const requirePackage = createRequire(join(packageRoot, 'package.json'));
const Ajv = requirePackage('ajv').default;
const { loadIntegrations } = await import(
  pathToFileURL(join(packageRoot, 'dist/integrations/manifest.js')).href
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

async function pythonFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await pythonFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith('.py')) {
      found.push(path);
    }
  }
  return found;
}

let schemaCount = 0;
let recipeCount = 0;
for (const integration of integrations) {
  const { manifest, root } = integration;
  const identity = `${manifest.kind}:${manifest.id}/${manifest.foundryGeneration ?? 'flat'}`;
  // Containment, identity and script syntax are re-checked against the installed files.
  await validatePackageFiles(integration);
  assert.equal(
    Object.hasOwn(manifest, 'entrypoint'),
    false,
    `${identity} must not declare a Python entrypoint`,
  );
  assert.deepEqual(await pythonFiles(root), [], `${identity} still ships Python files`);
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
  if (!recipes) {
    continue; // Recipes are optional for a manually copied package.
  }
  const validators = new Map(
    manifest.operations.map((operation) => [
      `${manifest.kind}_${manifest.id}_${operation.id}`,
      ajv.compile(operation.inputSchema),
    ]),
  );
  for (const call of recipes.calls) {
    const validate = validators.get(call.name);
    assert(validate, `${identity} recipe names an unknown operation: ${call.name}`);
    const { target_id, ...arguments_ } = call.arguments;
    assert.equal(target_id, recipes.target_id);
    assert(
      validate(arguments_),
      `${identity} recipe ${call.id}: ${ajv.errorsText(validate.errors)}`,
    );
    recipeCount += 1;
  }
}
assert(
  recipeCount >= 10,
  'Bundled generation variants did not exercise their documented recipe contracts',
);
console.log(
  `Integration smoke passed: ${integrations.length} independent packages, ${schemaCount} strict schemas, ${recipeCount} validated recipes. Bindings and probes were compiled only; no live Foundry request or compatibility test was performed.`,
);
