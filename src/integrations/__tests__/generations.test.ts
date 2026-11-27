import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { IntegrationManager } from '../manager.js';
import { type IntegrationLoadFailure, loadIntegrations } from '../manifest.js';
import {
  type IntegrationEnvironment,
  type IntegrationKind,
  parseFoundryGeneration,
} from '../types.js';

const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
// `python3` is not installed on every platform, so the interpreter is resolved
// once here and honours the same override the server configuration accepts.
const defaultPython = process.platform === 'win32' ? 'python' : 'python3';
const python = process.env.FOUNDRY_PYTHON_EXECUTABLE ?? defaultPython;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'foundry-generations-'));
  roots.push(root);
  const worker = join(root, 'python/foundry_mcp_modules');
  await mkdir(worker, { recursive: true });
  await copyFile(
    join(sourceRoot, 'python/foundry_mcp_modules/worker.py'),
    join(worker, 'worker.py'),
  );
  return root;
}

async function fixture(
  root: string,
  id: string,
  generation?: number,
  {
    kind = 'module',
    operation = 'read',
    writes = false,
  }: {
    kind?: IntegrationKind;
    operation?: string;
    writes?: boolean;
  } = {},
): Promise<string> {
  const identity = join(root, kind === 'module' ? 'modules' : 'systems', id);
  const directory = generation === undefined ? identity : join(identity, String(generation));
  await mkdir(directory, { recursive: true });
  const definition = {
    id: operation,
    description: 'Fixture operation',
    inputSchema: {
      type: 'object',
      properties: { actor_uuid: { type: 'string' } },
      required: ['actor_uuid'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object', additionalProperties: true },
    binding: 'binding.js',
    probe: 'probe.js',
    readOnly: true,
  };
  const manifest = {
    schemaVersion: 1,
    protocolVersion: 1,
    kind,
    id,
    ...(generation === undefined ? {} : { foundryGeneration: generation }),
    adapterVersion: `fixture-${generation ?? 'legacy'}`,
    updatedAt: '2026-11-22',
    entrypoint: 'adapter.py',
    status: 'experimental',
    upstream: { repository: null, reference: null, updatedAt: null, verifiedAt: null },
    compatibility: { foundryVersions: [], integrationVersions: [], tested: [] },
    operations: [definition, ...(writes ? [{ ...definition, id: 'write', readOnly: false }] : [])],
  };
  await Promise.all([
    writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest)),
    writeFile(join(directory, 'README.md'), 'Fixture package\n'),
    writeFile(join(directory, 'binding.js'), `// VARIANT_${generation ?? 'legacy'}\nreturn {};\n`),
    writeFile(
      join(directory, 'probe.js'),
      `// PROBE VARIANT_${generation ?? 'legacy'}\nreturn {ready: true};\n`,
    ),
    writeFile(
      join(directory, 'adapter.py'),
      'from pathlib import Path\nPath(__file__).with_name("imported").touch()\n' +
        'class Adapter:\n    async def execute(self, operation, arguments, context):\n' +
        '        return await context.invoke(operation, arguments)\n',
    ),
  ]);
  return directory;
}

function environment(
  foundryVersion: string,
  id = 'fixture',
  kind: IntegrationKind = 'module',
): IntegrationEnvironment {
  return {
    foundryVersion,
    system: { id: kind === 'system' ? id : 'custom', version: 'test' },
    modules: kind === 'module' ? [{ id, version: 'test', active: true }] : [],
  };
}

async function changeManifest(
  directory: string,
  edit: (manifest: Record<string, unknown>) => void,
): Promise<void> {
  const path = join(directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  edit(manifest);
  await writeFile(path, JSON.stringify(manifest));
}

describe('generation-specific integration discovery', () => {
  it('loads separate variants with identical public names without a collision', async () => {
    const root = await fixtureRoot();
    await fixture(root, 'fixture', 13);
    await fixture(root, 'fixture', 14);
    const packages = await loadIntegrations(root);
    expect(packages.map((entry) => entry.manifest.foundryGeneration)).toEqual([13, 14]);
    expect(packages.every((entry) => entry.manifest.id === 'fixture')).toBe(true);
  });

  it.each([
    [
      'missing generation',
      (value: Record<string, unknown>) => {
        delete value.foundryGeneration;
      },
    ],
    [
      'wrong generation',
      (value: Record<string, unknown>) => {
        value.foundryGeneration = 13;
      },
    ],
    [
      'string generation',
      (value: Record<string, unknown>) => {
        value.foundryGeneration = '14';
      },
    ],
    [
      'wrong identity',
      (value: Record<string, unknown>) => {
        value.id = 'another';
      },
    ],
    [
      'wrong family',
      (value: Record<string, unknown>) => {
        value.kind = 'system';
      },
    ],
  ] as const)('rejects %s in a numeric variant', async (_label, edit) => {
    const root = await fixtureRoot();
    const directory = await fixture(root, 'fixture', 14);
    await changeManifest(directory, edit);
    await expect(loadIntegrations(root)).rejects.toMatchObject({ code: 'invalid_manifest' });
  });

  it('rejects generation directories below the supported minimum', async () => {
    const root = await fixtureRoot();
    await fixture(root, 'fixture', 12);
    await expect(loadIntegrations(root)).rejects.toMatchObject({ code: 'invalid_manifest' });
  });

  it('does not accept generation metadata in the legacy flat location', async () => {
    const root = await fixtureRoot();
    const directory = await fixture(root, 'fixture');
    await changeManifest(directory, (manifest) => {
      manifest.foundryGeneration = 14;
    });
    await expect(loadIntegrations(root)).rejects.toMatchObject({ code: 'invalid_manifest' });
  });

  it('rejects an ambiguous flat/versioned identity without choosing either layout', async () => {
    const root = await fixtureRoot();
    await fixture(root, 'fixture');
    await fixture(root, 'fixture', 14);
    const failures: IntegrationLoadFailure[] = [];
    expect(await loadIntegrations(root, { onError: (failure) => failures.push(failure) })).toEqual(
      [],
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.error.code).toBe('ambiguous_layout');
    await expect(loadIntegrations(root)).rejects.toMatchObject({ code: 'ambiguous_layout' });
  });

  it('withholds colliding owners only in the overlapping generation', async () => {
    const root = await fixtureRoot();
    await fixture(root, 'alpha', 13, { operation: 'beta_read' });
    await fixture(root, 'alpha_beta', 13);
    await fixture(root, 'alpha_beta', 14);
    const failures: IntegrationLoadFailure[] = [];
    const packages = await loadIntegrations(root, { onError: (failure) => failures.push(failure) });
    expect(packages.map((entry) => [entry.manifest.id, entry.manifest.foundryGeneration])).toEqual([
      ['alpha_beta', 14],
    ]);
    expect(failures).toHaveLength(2);
    expect(
      failures.every(
        (failure) => failure.foundryGeneration === 13 && failure.error.code === 'duplicate_tool',
      ),
    ).toBe(true);
  });

  it('treats a legacy public-name collision as overlapping every generation', async () => {
    const root = await fixtureRoot();
    await fixture(root, 'alpha', undefined, { operation: 'beta_read' });
    await fixture(root, 'alpha_beta', 13);
    await fixture(root, 'alpha_beta', 14);
    const failures: IntegrationLoadFailure[] = [];
    expect(await loadIntegrations(root, { onError: (failure) => failures.push(failure) })).toEqual(
      [],
    );
    expect(failures).toHaveLength(3);
    expect(failures.every((failure) => failure.error.code === 'duplicate_tool')).toBe(true);
  });

  it.each(['manifest.json', 'binding.js', 'adapter.py'])(
    'rejects %s symlinked outside its selected variant',
    async (file) => {
      const root = await fixtureRoot();
      const a = await fixture(root, 'fixture', 13);
      const b = await fixture(root, 'fixture', 14);
      await rm(join(b, file));
      await symlink(join(a, file), join(b, file));
      const failures: IntegrationLoadFailure[] = [];
      const packages = await loadIntegrations(root, {
        onError: (failure) => failures.push(failure),
      });
      expect(packages.map((entry) => entry.manifest.foundryGeneration)).toEqual([13]);
      expect(failures[0]).toMatchObject({
        foundryGeneration: 14,
        error: { code: 'invalid_manifest' },
      });
    },
  );

  it('rejects a generation directory symlinked outside its integration identity', async () => {
    const root = await fixtureRoot();
    const outside = await fixture(root, 'outside', 14);
    await mkdir(join(root, 'modules/fixture'), { recursive: true });
    await symlink(outside, join(root, 'modules/fixture/14'));
    const failures: IntegrationLoadFailure[] = [];
    const packages = await loadIntegrations(root, { onError: (failure) => failures.push(failure) });
    expect(packages.map((entry) => entry.manifest.id)).toEqual(['outside']);
    expect(failures[0]).toMatchObject({
      id: 'fixture',
      foundryGeneration: 14,
      error: { code: 'invalid_manifest' },
    });
  });

  it('rejects a generation alias even when it stays inside the same identity', async () => {
    const root = await fixtureRoot();
    const a = await fixture(root, 'fixture', 13);
    await symlink(a, join(root, 'modules/fixture/14'));
    const failures: IntegrationLoadFailure[] = [];
    const packages = await loadIntegrations(root, { onError: (failure) => failures.push(failure) });
    expect(packages.map((entry) => entry.manifest.foundryGeneration)).toEqual([13]);
    expect(failures[0]?.error.message).toContain('aliases its expected path');
  });
});

describe('target generation selection', () => {
  it.each([13, 14])(
    'imports and probes only generation %s with the real Python worker',
    async (generation) => {
      const root = await fixtureRoot();
      const paths = [await fixture(root, 'fixture', 13), await fixture(root, 'fixture', 14)];
      const scripts: string[] = [];
      const manager = new IntegrationManager({
        targetId: `target-${generation}`,
        packageRoot: root,
        pythonExecutable: python,
        execute: async (script, args) => {
          scripts.push(script);
          return script.includes('PROBE') ? { ready: true } : { generation, ...args };
        },
      });
      try {
        await manager.reconcile(environment(`${generation}.370`), 1);
        expect(manager.list()).toHaveLength(1);
        expect(manager.list()[0]).toMatchObject({
          foundryGeneration: generation,
          availableGenerations: [13, 14],
          state: 'ready',
        });
        expect(manager.getTools().map((tool) => tool.name)).toEqual(['module_fixture_read']);
        await expect(
          manager.call('module_fixture_read', { actor_uuid: 'Actor.same' }),
        ).resolves.toEqual({ generation, actor_uuid: 'Actor.same' });
        expect(scripts.every((script) => script.includes(`VARIANT_${generation}`))).toBe(true);
        for (const path of paths) {
          if (path.endsWith(String(generation))) {
            expect((await stat(join(path, 'imported'))).isFile()).toBe(true);
          } else {
            await expect(stat(join(path, 'imported'))).rejects.toMatchObject({ code: 'ENOENT' });
          }
        }
      } finally {
        await manager.close();
      }
    },
  );

  it.each([
    { version: '14.370', variants: [13] },
    { version: '15.400', variants: [13, 14] },
    { version: '12.999', variants: [13, 14] },
    { version: 'unknown', variants: [13, 14] },
    { version: '14broken', variants: [13, 14] },
  ])('does not fall back for Foundry $version', async ({ version, variants }) => {
    const root = await fixtureRoot();
    const paths = await Promise.all(variants.map((value) => fixture(root, 'fixture', value)));
    let probes = 0;
    const manager = new IntegrationManager({
      targetId: 'unsupported-generation',
      packageRoot: root,
      pythonExecutable: '/missing/python',
      execute: async () => {
        probes += 1;
        return { ready: true };
      },
    });
    try {
      await manager.reconcile(environment(version), 1);
      expect(manager.getTools()).toEqual([]);
      expect(manager.list()).toHaveLength(1);
      expect(manager.list()[0]).toMatchObject({
        state: 'incompatible',
        availableGenerations: variants,
        operations: [],
      });
      expect(manager.list()[0]?.reason).toMatch(/No integration variant|unknown Foundry version/);
      expect(probes).toBe(0);
      for (const path of paths) {
        await expect(stat(join(path, 'imported'))).rejects.toMatchObject({ code: 'ENOENT' });
      }
    } finally {
      await manager.close();
    }
  });

  it('accepts a separately supplied generation 15 package instead of borrowing generation 14', async () => {
    const root = await fixtureRoot();
    await fixture(root, 'fixture', 15);
    const scripts: string[] = [];
    const manager = new IntegrationManager({
      targetId: 'future',
      packageRoot: root,
      pythonExecutable: python,
      execute: async (script) => {
        scripts.push(script);
        return { ready: true };
      },
    });
    try {
      await manager.reconcile(environment('15.400'), 1);
      expect(manager.list()[0]).toMatchObject({
        foundryGeneration: 15,
        availableGenerations: [15],
        state: 'ready',
      });
      expect(scripts.every((script) => script.includes('VARIANT_15'))).toBe(true);
    } finally {
      await manager.close();
    }
  });

  it('keeps flat third-party packages usable without a known Foundry generation', async () => {
    const root = await fixtureRoot();
    await fixture(root, 'fixture');
    const manager = new IntegrationManager({
      targetId: 'legacy',
      packageRoot: root,
      pythonExecutable: python,
      execute: async (script) => (script.includes('PROBE') ? { ready: true } : { legacy: true }),
    });
    try {
      await manager.reconcile(environment('test'), 1);
      expect(manager.list()[0]).toMatchObject({ state: 'ready', availableGenerations: [] });
      expect(manager.list()[0]?.foundryGeneration).toBeUndefined();
      await expect(
        manager.call('module_fixture_read', { actor_uuid: 'Actor.same' }),
      ).resolves.toEqual({ legacy: true });
    } finally {
      await manager.close();
    }
  });

  it('reports a malformed unselected variant without blocking the healthy generation', async () => {
    const root = await fixtureRoot();
    const broken = await fixture(root, 'fixture', 13);
    await fixture(root, 'fixture', 14);
    await writeFile(join(broken, 'manifest.json'), '{invalid');
    const manager = new IntegrationManager({
      targetId: 'healthy',
      packageRoot: root,
      pythonExecutable: python,
      execute: async (script) => {
        expect(script).toContain('VARIANT_14');
        return { ready: true };
      },
    });
    try {
      await manager.reconcile(environment('14.370'), 1);
      expect(manager.list()).toHaveLength(1);
      expect(manager.list()[0]).toMatchObject({
        state: 'ready',
        foundryGeneration: 14,
        availableGenerations: [14],
        variantErrors: [{ foundryGeneration: 13 }],
      });
      await expect(stat(join(broken, 'imported'))).rejects.toMatchObject({ code: 'ENOENT' });
      await manager.reconcile(environment('13.350'), 2);
      expect(manager.getTools()).toEqual([]);
      expect(manager.list()[0]?.state).toBe('error');
    } finally {
      await manager.close();
    }
  });

  it('keeps generations and write permissions independent for two system targets', async () => {
    const root = await fixtureRoot();
    await fixture(root, 'fixture', 13, { kind: 'system', writes: true });
    await fixture(root, 'fixture', 14, { kind: 'system', writes: true });
    const calls: Array<{ target: string; write: boolean; actor: unknown }> = [];
    const make = (generation: number, writesEnabled: boolean) =>
      new IntegrationManager({
        targetId: `target-${generation}`,
        packageRoot: root,
        writesEnabled,
        pythonExecutable: python,
        execute: async (script, args, readOnly) => {
          expect(script).toContain(`VARIANT_${generation}`);
          if (script.includes('PROBE')) {
            return { ready: true };
          }
          calls.push({ target: `target-${generation}`, write: !readOnly, actor: args.actor_uuid });
          return { target: `target-${generation}`, actor_uuid: args.actor_uuid };
        },
      });
    const a = make(13, false);
    const b = make(14, true);
    try {
      await Promise.all([
        a.reconcile(environment('13.350', 'fixture', 'system'), 1),
        b.reconcile(environment('14.370', 'fixture', 'system'), 1),
      ]);
      expect(a.has('system_fixture_write')).toBe(false);
      expect(b.has('system_fixture_write')).toBe(true);
      await expect(
        a.call('system_fixture_write', { actor_uuid: 'Actor.same' }),
      ).rejects.toMatchObject({ code: 'integration_unavailable' });
      const results = await Promise.all([
        a.call('system_fixture_read', { actor_uuid: 'Actor.same' }),
        b.call('system_fixture_write', { actor_uuid: 'Actor.same' }),
      ]);
      expect(results.map((result) => (result as { target: string }).target)).toEqual([
        'target-13',
        'target-14',
      ]);
      expect(calls.filter((call) => call.write)).toEqual([
        { target: 'target-14', write: true, actor: 'Actor.same' },
      ]);
      const copy = b.list();
      copy[0]?.availableGenerations?.push(99);
      expect(b.list()[0]?.availableGenerations).toEqual([13, 14]);
      await a.close();
      expect(b.has('system_fixture_write')).toBe(true);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });
});

describe('Foundry generation parsing', () => {
  it.each(['14', '14.370', '14.370.1', ' 14.370 ', '14.370-beta.1'])('recognizes %s', (version) => {
    expect(parseFoundryGeneration(version)).toBe(14);
  });
  it.each(['', 'unknown', '14garbage', '014.370', '14.', '1e3', 'Infinity', '9007199254740992.1'])(
    'rejects ambiguous version %s',
    (version) => {
      expect(parseFoundryGeneration(version)).toBeUndefined();
    },
  );
});
