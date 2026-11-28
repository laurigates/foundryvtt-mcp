#!/usr/bin/env node
/** Offline, checkout-only scaffolder. It never fetches code or installs dependencies. */
import { access, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { INTEGRATION_ID, parseGeneration } from './integration-packages.mjs';

const checkoutRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const buildSource = String.raw`#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifest, binding, probe } from './src/registry.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
if (!['--write', '--check'].includes(mode) || process.argv.length !== 3) {
  throw new Error('Use node build.mjs --write or --check');
}
const files = new Map([
  ['manifest.json', JSON.stringify(manifest, null, 2) + '\n'],
  ['bindings/get_status.js', binding],
  ['probes/get_status.js', probe],
]);
for (const [name, content] of files) {
  const path = join(root, name);
  if (mode === '--write') {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  } else {
    let actual;
    try { actual = await readFile(path, 'utf8'); } catch { actual = undefined; }
    if (actual !== content) throw new Error('Generated asset differs: ' + name + '; run node build.mjs --write');
  }
}
console.log(manifest.kind + ':' + manifest.id + '/' + manifest.foundryGeneration + ': generated files ' + mode.slice(2));
`;

const adapterSource = String.raw`"""Unimplemented scaffold: the host probe prevents publishing its operation."""
import json
from pathlib import Path


class Adapter:
    def __init__(self):
        manifest = json.loads(Path(__file__).with_name("manifest.json").read_text(encoding="utf-8"))
        self.operations = frozenset(operation["id"] for operation in manifest["operations"])

    async def execute(self, operation, arguments, context):
        if operation not in self.operations or not isinstance(arguments, dict):
            raise ValueError("Unknown operation or invalid arguments")
        return await context.invoke(operation, arguments)
`;

const bindingSource =
  '// Scaffold only: implement a specific upstream contract before making its probe ready.\n' +
  'throw Object.assign(new Error("Integration skeleton is not implemented"), { code: "integration_not_ready" });\n';
const probeSource =
  '// INTEGRATION_PROBE: no capability is advertised by an unfinished scaffold.\n' +
  'return { ready: false, reason: "Integration skeleton is not implemented" };\n';

const testSource = String.raw`import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
const run = async (file) => runInNewContext('(async () => {\n' + await readFile(new URL('../' + file, import.meta.url), 'utf8') + '\n})()');
test('unfinished scaffold is unavailable and cannot report an operation as completed', async () => {
  assert.equal((await run('probes/get_status.js')).ready, false);
  await assert.rejects(run('bindings/get_status.js'), { code: 'integration_not_ready' });
});
`;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function safeParent(path) {
  await mkdir(path, { recursive: true });
  if ((await realpath(path)) !== path) {
    throw new Error(`Scaffold directory may not alias another path: ${path}`);
  }
}

export async function createIntegration({
  kind,
  id,
  foundry,
  upstream,
  packageRoot = checkoutRoot,
}) {
  if (!['system', 'module'].includes(kind)) {
    throw new Error('--kind must be system or module');
  }
  if (typeof id !== 'string' || !INTEGRATION_ID.test(id) || id.length > 100) {
    throw new Error('--id must be a safe integration identifier of at most 100 characters');
  }
  const foundryGeneration = parseGeneration(foundry);
  if (upstream !== undefined) {
    let url;
    try {
      url = new URL(upstream);
    } catch {
      throw new Error('--upstream must be an HTTPS repository URL');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
      throw new Error(
        '--upstream must be an HTTPS repository URL without credentials, query, or fragment',
      );
    }
  }
  const base = await realpath(packageRoot);
  const family = join(base, kind === 'system' ? 'systems' : 'modules');
  await safeParent(family);
  const identity = join(family, id);
  await safeParent(identity);
  if (await exists(join(identity, 'manifest.json'))) {
    throw new Error('Cannot add a generation beneath a legacy flat package');
  }
  const root = join(identity, String(foundryGeneration));
  // Exclusive creation prevents accidental overwrites, including empty folders.
  await mkdir(root);
  const operation = {
    id: 'get_status',
    description:
      'Unimplemented scaffold; unavailable until its fixed binding and probe are completed.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { status: { type: 'string', enum: ['not-implemented'] } },
      required: ['status'],
    },
    binding: 'bindings/get_status.js',
    probe: 'probes/get_status.js',
    readOnly: true,
  };
  const manifest = {
    schemaVersion: 1,
    protocolVersion: 1,
    kind,
    id,
    foundryGeneration,
    adapterVersion: '0.1.0',
    updatedAt: new Date().toISOString().slice(0, 10),
    entrypoint: 'adapter.py',
    status: 'experimental',
    upstream: { repository: upstream ?? null, reference: null, updatedAt: null, verifiedAt: null },
    compatibility: {
      foundryVersions: [String(foundryGeneration)],
      integrationVersions: [],
      tested: [],
    },
    operations: [operation],
  };
  const targetId = 'replace-with-your-target-id';
  const recipes = {
    target_id: targetId,
    calls: [
      {
        id: 'unavailable-scaffold',
        name: `${kind}_${id}_get_status`,
        arguments: { target_id: targetId },
      },
    ],
    workflows: [{ id: 'implementation-required', steps: ['unavailable-scaffold'] }],
  };
  const readme = `# ${id} — Foundry ${foundryGeneration} integration scaffold

**Not implemented.** This folder is an independent adapter skeleton, not a working integration. Its probe always returns \`ready: false\`, and its binding throws \`integration_not_ready\`. The example call is a contract placeholder and cannot run through the host until implementation is complete.

Adapter version: 0.1.0. Upstream repository: ${upstream ?? 'not yet recorded'}. Upstream release/tag/commit: **not inspected**. Tested versions: none; live verification: none.

## Implement this variant

1. Inspect the official upstream source for this Foundry generation. Pin the latest applicable release; otherwise tag; otherwise commit hash. Record the upstream version separately from the adapter version and retain exact source links.
2. Replace the specific operation contracts and implementation in \`src/registry.mjs\`; extend \`build.mjs\` when adding operations. Keep input/output schemas strict and return serializable data.
3. Probe the actual runtime for the required generation, upstream version, active system/module, readiness, API capabilities and permissions. Keep the probe unavailable until those conditions are verified. Call methods on current runtime documents so installed wrappers remain active.
4. Mark every roll, chat publication, resource consumption and mutation \`readOnly: false\`. Use the target write gate and runtime document permissions. After a dispatched action with uncertain outcome, report \`outcome_unknown\`; never retry or fall back automatically.
5. Add meaningful binding/probe tests and operation examples. Update provenance and compatibility metadata honestly; source inspection alone is not a live compatibility test.

From this folder, run \`node build.mjs --write\`, \`node build.mjs --check\`, and \`node --test tests/*.test.mjs\`. From the project checkout, \`npm run check:integrations\` and \`npm run test:bindings\` discover this folder automatically. Python uses the standard library; dependencies are never installed automatically.

## Copy or install manually

Copy this complete folder to \`${kind === 'system' ? 'systems' : 'modules'}/${id}/${foundryGeneration}/\` under the host package root. Keep every variant self-contained. There is no central adapter registry to edit. Restart the host or refresh the affected target after copying; the manager selects the installed runtime's generation and does not fall back to a sibling generation. Do not copy this unfinished scaffold into a live installation expecting an available tool.
`;
  const files = new Map([
    ['README.md', readme],
    ['adapter.py', adapterSource],
    ['build.mjs', buildSource],
    [
      'src/registry.mjs',
      '// Authored scaffold source. No runtime capability is ready yet.\n' +
        'export const manifest = ' +
        JSON.stringify(manifest, null, 2) +
        ';\n' +
        'export const binding = ' +
        JSON.stringify(bindingSource) +
        ';\n' +
        'export const probe = ' +
        JSON.stringify(probeSource) +
        ';\n',
    ],
    ['manifest.json', `${JSON.stringify(manifest, null, 2)}\n`],
    ['bindings/get_status.js', bindingSource],
    ['probes/get_status.js', probeSource],
    ['tests/runtime.test.mjs', testSource],
    ['examples/workflows.json', `${JSON.stringify(recipes, null, 2)}\n`],
  ]);
  try {
    for (const [name, contents] of files) {
      const path = join(root, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents, { flag: 'wx' });
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return { root, manifest };
}

export function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!['--kind', '--id', '--foundry', '--upstream'].includes(option) || !value) {
      throw new Error(`Invalid option: ${option ?? ''}`);
    }
    const key = option.slice(2);
    if (key in options) {
      throw new Error(`Duplicate option: ${option}`);
    }
    options[key] = value;
  }
  return options;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await createIntegration(parseArguments(process.argv.slice(2)));
    console.log(
      `Created ${result.root}. The scaffold remains unavailable until implemented and tested.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
