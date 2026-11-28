import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  createIntegration,
  parseArguments as parseCreateArguments,
} from '../create-integration.mjs';
import {
  containedFile,
  discoverIntegrationPackages,
  parseGeneration,
  selectPackages,
  validatePackageFiles,
} from '../integration-packages.mjs';
import { parseArguments, runIntegrationCommand } from '../integrations.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'foundry-integration-tooling-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function node(args, cwd) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout;
}

test('scaffolder creates a self-contained package with an unavailable operation and reproducible generation', async (t) => {
  const packageRoot = await fixture(t);
  const { root, manifest } = await createIntegration({
    kind: 'module',
    id: 'example-module',
    foundry: 14,
    packageRoot,
    upstream: 'https://example.com/official/repository',
  });
  assert.equal(manifest.foundryGeneration, 14);
  assert.equal(manifest.upstream.reference, null);
  assert.equal(manifest.upstream.verifiedAt, null);
  assert.deepEqual(manifest.compatibility.tested, []);
  const packages = await discoverIntegrationPackages(packageRoot);
  assert.equal(packages.length, 1);
  await validatePackageFiles(packages[0]);
  node(['build.mjs', '--check'], root);
  node(['--test', 'tests/runtime.test.mjs'], root);
  const probe = await readFile(join(root, 'probes/get_status.js'), 'utf8');
  assert.equal((await runInNewContext(`(async () => { ${probe} })()`)).ready, false);
  const binding = await readFile(join(root, 'bindings/get_status.js'), 'utf8');
  await assert.rejects(runInNewContext(`(async () => { ${binding} })()`), {
    code: 'integration_not_ready',
  });
  const isolated = join(packageRoot, 'isolated-copy');
  await cp(root, isolated, { recursive: true });
  node(['build.mjs', '--write'], isolated);
  node(['build.mjs', '--check'], isolated);
});

test('discovery selects new identities and generations without a central registry', async (t) => {
  const packageRoot = await fixture(t);
  await createIntegration({ kind: 'module', id: 'first-example', foundry: 13, packageRoot });
  await createIntegration({ kind: 'module', id: 'first-example', foundry: 14, packageRoot });
  await createIntegration({ kind: 'system', id: 'second-example', foundry: 15, packageRoot });
  const packages = await discoverIntegrationPackages(packageRoot);
  assert.equal(packages.length, 3);
  assert.deepEqual(
    selectPackages(packages, { id: 'first-example', foundryGeneration: 14 }).map(
      (pkg) => pkg.relativeRoot,
    ),
    ['modules/first-example/14'],
  );
  assert.equal(selectPackages(packages, { kind: 'system' }).length, 1);
  assert.equal(
    await runIntegrationCommand('check', { packageRoot, filters: { foundryGeneration: 13 } }),
    1,
  );
});

test('manifest-only and legacy flat packages retain basic offline checks', async (t) => {
  const packageRoot = await fixture(t);
  const generated = await createIntegration({
    kind: 'module',
    id: 'legacy-example',
    foundry: 14,
    packageRoot,
  });
  const identity = join(packageRoot, 'modules/legacy-example');
  const staged = join(packageRoot, 'temporary-copy');
  await cp(generated.root, staged, { recursive: true });
  await rm(generated.root, { recursive: true });
  await cp(staged, identity, { recursive: true });
  await rm(join(identity, 'build.mjs'));
  delete generated.manifest.foundryGeneration;
  await writeFile(join(identity, 'manifest.json'), JSON.stringify(generated.manifest));
  assert.equal((await discoverIntegrationPackages(packageRoot))[0].foundryGeneration, undefined);
  assert.equal(await runIntegrationCommand('check', { packageRoot }), 1);
  await rm(join(identity, 'bindings/get_status.js'));
  await assert.rejects(runIntegrationCommand('check', { packageRoot }), /ENOENT/);
});

test('scaffolder refuses overwrite, flat-layout nesting, malformed arguments and directory aliases', async (t) => {
  const packageRoot = await fixture(t);
  const options = { kind: 'module', id: 'example-module', foundry: 14, packageRoot };
  const generated = await createIntegration(options);
  const before = await readFile(join(generated.root, 'manifest.json'), 'utf8');
  await assert.rejects(createIntegration(options), /EEXIST/);
  assert.equal(await readFile(join(generated.root, 'manifest.json'), 'utf8'), before);
  for (const id of ['../escape', 'nested/id', '.hidden', 'bad:id', 'bad\\id', 'x'.repeat(101)]) {
    await assert.rejects(createIntegration({ ...options, id }), /identifier/);
  }
  for (const foundry of [12, 0, -1, true, null, '014', '14.1', '14/../13']) {
    await assert.rejects(createIntegration({ ...options, foundry }), /generation/);
  }
  await assert.rejects(createIntegration({ ...options, kind: 'arbitrary' }), /kind/);
  await assert.rejects(createIntegration({ ...options, upstream: 'file:///tmp/repo' }), /HTTPS/);
  await assert.rejects(
    createIntegration({ ...options, upstream: 'https://user:secret@example.com/repo' }),
    /credentials/,
  );
  await mkdir(join(packageRoot, 'modules/flat-example'));
  await writeFile(join(packageRoot, 'modules/flat-example/manifest.json'), '{}');
  await assert.rejects(createIntegration({ ...options, id: 'flat-example' }), /legacy flat/);
  await symlink(
    join(packageRoot, 'modules/example-module'),
    join(packageRoot, 'modules/alias-example'),
  );
  await assert.rejects(createIntegration({ ...options, id: 'alias-example' }), /alias/);
});

test('discovery rejects identity/generation mismatch and mixed layouts', async (t) => {
  const packageRoot = await fixture(t);
  const { root, manifest } = await createIntegration({
    kind: 'system',
    id: 'example',
    foundry: 14,
    packageRoot,
  });
  await writeFile(
    join(root, 'manifest.json'),
    JSON.stringify({ ...manifest, foundryGeneration: 13 }),
  );
  await assert.rejects(discoverIntegrationPackages(packageRoot), /identity\/generation/);
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(root, '../manifest.json'), JSON.stringify(manifest));
  await assert.rejects(discoverIntegrationPackages(packageRoot), /Ambiguous/);
});

test('discovery and assets reject sibling-generation aliases and escaping file paths', async (t) => {
  const packageRoot = await fixture(t);
  const v13 = await createIntegration({ kind: 'module', id: 'example', foundry: 13, packageRoot });
  const v14 = await createIntegration({ kind: 'module', id: 'example', foundry: 14, packageRoot });
  await symlink(v13.root, join(v14.root, '../15'));
  await assert.rejects(discoverIntegrationPackages(packageRoot), /alias/);
  await rm(join(v14.root, '../15'));
  await assert.rejects(containedFile(v14.root, '../13/adapter.py'), /relative/);
  await symlink(join(v13.root, 'adapter.py'), join(v14.root, 'sibling.py'));
  await assert.rejects(containedFile(v14.root, 'sibling.py'), /escapes/);
  await assert.rejects(containedFile(v14.root, join(v14.root, 'adapter.py')), /relative/);
});

test('command arguments keep generation filtering explicit and reject malformed input', () => {
  assert.deepEqual(parseArguments(['test', '--kind', 'system', '--foundry', '14']), {
    action: 'test',
    filters: { kind: 'system', foundryGeneration: 14 },
  });
  assert.deepEqual(
    parseCreateArguments(['--kind', 'module', '--id', 'example', '--foundry', '14']),
    { kind: 'module', id: 'example', foundry: '14' },
  );
  assert.equal(parseGeneration('14'), 14);
  assert.throws(() => parseGeneration('014'), /generation/);
  assert.throws(() => parseArguments(['check', '--unknown', 'value']), /Invalid option/);
  assert.throws(
    () => parseArguments(['check', '--kind', 'system', '--kind', 'module']),
    /Duplicate/,
  );
  assert.throws(() => parseCreateArguments(['--kind']), /Invalid option/);
  assert.throws(() => parseCreateArguments(['--id', 'a', '--id', 'b']), /Duplicate/);
});
