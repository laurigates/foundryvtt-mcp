import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { generatedFiles, generatedMarker, generatePackage, packageRoot } from '../build.mjs';
import { operations } from '../src/registry.mjs';
import { legacyBinding, legacyProbe } from '../src/legacy.mjs';

const files = generatedFiles();
const manifest = JSON.parse(files.get('manifest.json'));
const definitions = new Map(manifest.operations.map((operation) => [operation.id, operation]));
const methods = [...new Set(operations.flatMap((operation) => operation.requiredMethods))];

function fixture() {
  const calls = [];
  const api = Object.fromEntries(methods.map((name) => [name, (...args) => {
    calls.push({ name, args });
    return [];
  }]));
  return {
    calls,
    args: {},
    game: {
      ready: true,
      release: { generation: 13 },
      version: '13.348',
      user: { id: 'gm', isGM: true },
      modules: new Map([
        ['item-piles', { active: true, version: '3.3.4' }],
        ['socketlib', { active: true }],
        ['lib-wrapper', { active: true }],
      ]),
      itempiles: { API: api },
    },
    fromUuid: async () => null,
  };
}

async function run(path, context) {
  return runInNewContext(`(async () => {\n${files.get(path)}\n})()`, context);
}

test('generated package is current, deterministic and contains the explicit public contracts', async () => {
  await generatePackage({ mode: 'check' });
  assert.deepEqual([...generatedFiles()], [...files]);
  assert.ok(operations.length >= 30, 'The package must expose the complete implemented families');
  assert.equal(manifest.operations.length, operations.length);
  assert.equal(new Set(manifest.operations.map((operation) => operation.id)).size, operations.length);
  assert.equal(manifest.adapterVersion, '0.2.1');
  assert.equal(manifest.foundryGeneration, 13);
  assert.equal(manifest.status, 'experimental');
  assert.equal(manifest.upstream.reference, '3.3.4@85ab971406623fb1c5d01eb1f093fe4855ede6e4');
  assert.equal(manifest.upstream.verifiedAt, null);
  assert.deepEqual(manifest.compatibility.tested, []);
  assert.deepEqual(manifest.compatibility.integrationVersions, []);
  for (const operation of manifest.operations) {
    assert.equal(typeof operation.readOnly, 'boolean');
    assert.equal(operation.inputSchema.type, 'object');
    assert.equal(operation.inputSchema.additionalProperties, false);
    assert.equal('target_id' in (operation.inputSchema.properties ?? {}), false);
    if (operation.id === 'get_items') {
      assert.equal(files.get(operation.binding), legacyBinding);
      assert.equal(files.get(operation.probe), legacyProbe);
    } else assert.ok(files.get(operation.binding).startsWith(generatedMarker));
    assert.ok(files.get(operation.probe).includes('INTEGRATION_PROBE'));
    if (!operation.readOnly) {
      assert.match(operation.description, /writeEnabled=true/);
      assert.match(operation.description, /GM execution runtime/);
      assert.match(operation.description, /outcome_unknown/);
    }
  }
  assert.equal(definitions.get('get_items').binding, 'get_items.js');
  assert.equal(definitions.get('get_items').probe, 'probe.js');
  assert.equal(definitions.get('get_items').readOnly, true);
  assert.equal(definitions.get('get_items').outputSchema.type, 'array');
  assert.deepEqual(definitions.get('get_items').inputSchema.required, ['actor_uuid']);
  for (const id of ['transfer_items', 'create_pile', 'delete_pile', 'split_pile']) {
    assert.equal(definitions.get(id)?.readOnly, false, `${id} must remain a write`);
  }
});

test('check detects drift and orphans without writing; write removes only generated orphans', async () => {
  const root = await mkdtemp(join(packageRoot, 'tests/.generation-'));
  try {
    await generatePackage({ mode: 'write', root });
    await generatePackage({ mode: 'check', root });
    const path = join(root, 'get_items.js');
    await writeFile(path, 'hand-edited content\n');
    await assert.rejects(generatePackage({ mode: 'check', root }), /changed: get_items\.js/);
    assert.equal(await readFile(path, 'utf8'), 'hand-edited content\n');
    await generatePackage({ mode: 'write', root });
    const orphan = join(root, 'bindings/obsolete.js');
    await writeFile(orphan, `${generatedMarker}\nreturn null;\n`);
    await assert.rejects(generatePackage({ mode: 'check', root }), /orphan: bindings\/obsolete\.js/);
    await generatePackage({ mode: 'write', root });
    await assert.rejects(readFile(orphan), { code: 'ENOENT' });
    await writeFile(orphan, 'return "unrecognized source";\n');
    await assert.rejects(generatePackage({ mode: 'write', root }), /unrecognized file/);
    assert.equal(await readFile(orphan, 'utf8'), 'return "unrecognized source";\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const operation of operations) {
  const definition = definitions.get(operation.id);
  test(`${operation.id}: probe validates readiness without executing the API`, async () => {
    const context = fixture();
    const result = await run(definition.probe, context);
    assert.equal(result.ready, true);
    assert.deepEqual(context.calls, []);
    context.game.ready = false;
    assert.equal((await run(definition.probe, context)).ready, false);
    context.game.ready = true;
    context.game.modules.get('item-piles').active = false;
    assert.equal((await run(definition.probe, context)).ready, false);
    await assert.rejects(run(definition.binding, context), /Item Piles|item-piles|active|ready/);
    assert.deepEqual(context.calls, []);
  });

  test(`${operation.id}: missing required methods are rejected before dispatch`, async () => {
    for (const method of operation.requiredMethods) {
      const context = fixture();
      delete context.game.itempiles.API[method];
      const result = await run(definition.probe, context);
      assert.equal(result.ready, false, `${method} must be probed`);
      assert.equal(typeof result.reason, 'string');
      await assert.rejects(run(definition.binding, context), /API|available|function|method|requires/);
      assert.deepEqual(context.calls, []);
    }
  });

  test(`${operation.id}: write classification agrees with the GM gate`, async () => {
    const context = fixture();
    context.game.user = { id: 'player', isGM: false };
    assert.equal((await run(definition.probe, context)).ready, operation.readOnly);
    if (!operation.readOnly) {
      await assert.rejects(run(definition.binding, context), /GM|Game Master/);
      assert.deepEqual(context.calls, []);
    }
  });

  if (operation.id !== 'get_items') {
    test(`${operation.id}: new operations require the inspected version and dependencies`, async () => {
      for (const version of ['3.3.3', '3.3.5', undefined]) {
        const context = fixture();
        context.game.modules.get('item-piles').version = version;
        assert.equal((await run(definition.probe, context)).ready, false);
        await assert.rejects(run(definition.binding, context), /3\.3\.4|version/);
      }
      for (const generation of [12, 14, 15, undefined]) {
        const context = fixture();
        context.game.release.generation = generation;
        context.game.version = undefined;
        assert.equal((await run(definition.probe, context)).ready, false);
      }
      for (const generation of [13]) {
        const context = fixture();
        context.game.release.generation = generation;
        assert.equal((await run(definition.probe, context)).ready, true);
      }
      for (const dependency of ['socketlib', 'lib-wrapper']) {
        const context = fixture();
        context.game.modules.get(dependency).active = false;
        assert.equal((await run(definition.probe, context)).ready, false);
        await assert.rejects(run(definition.binding, context), /socketlib|lib-wrapper|dependenc/);
      }
    });
  }
}

test('legacy get_items remains capability-based without new version/dependency gates', async () => {
  const context = fixture();
  context.game.release = undefined;
  context.game.version = '11.315';
  context.game.modules.get('item-piles').version = 'historical';
  context.game.modules.delete('socketlib');
  context.game.modules.delete('lib-wrapper');
  context.game.user.isGM = false;
  assert.equal((await run('probe.js', context)).ready, true);
  context.fromUuid = undefined;
  assert.equal((await run('probe.js', context)).ready, false);
});
