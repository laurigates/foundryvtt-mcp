import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IntegrationManager } from '../manager.js';
import { type IntegrationLoadFailure, loadIntegrations } from '../manifest.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'foundry-integration-manifests-'));
  roots.push(root);
  return root;
}

async function integration(root: string, id: string, operation = 'read'): Promise<string> {
  const directory = join(root, 'modules', id);
  await mkdir(directory, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    protocolVersion: 1,
    kind: 'module',
    id,
    adapterVersion: 'test',
    updatedAt: '2026-11-22',
    status: 'experimental',
    upstream: { repository: null, reference: null, updatedAt: null, verifiedAt: null },
    compatibility: { foundryVersions: [], integrationVersions: [], tested: [] },
    operations: [
      {
        id: operation,
        description: 'Fixture read',
        inputSchema: { type: 'object', additionalProperties: false },
        outputSchema: { type: 'object', additionalProperties: true },
        binding: 'binding.js',
        probe: 'probe.js',
        readOnly: true,
      },
    ],
  };
  await Promise.all([
    writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest)),
    writeFile(join(directory, 'README.md'), 'Test-only integration\n'),
    writeFile(join(directory, 'binding.js'), 'return {};\n'),
    writeFile(join(directory, 'probe.js'), 'return {ready: true};\n'),
  ]);
  return directory;
}

describe('integration package failure isolation', () => {
  it.each(['manifest', 'binding'] as const)(
    'keeps a valid independent module when another package has an invalid %s',
    async (invalid) => {
      const root = await fixtureRoot();
      const broken = await integration(root, 'broken');
      await integration(root, 'healthy');
      if (invalid === 'manifest') {
        await writeFile(join(broken, 'manifest.json'), '{invalid');
      } else {
        await rm(join(broken, 'binding.js'));
      }
      const errors: IntegrationLoadFailure[] = [];
      const packages = await loadIntegrations(root, { onError: (error) => errors.push(error) });
      expect(packages.map((entry) => entry.manifest.id)).toEqual(['healthy']);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ kind: 'module', id: 'broken' });
      expect(errors[0]?.error.code).toBe('invalid_manifest');
      // Packaging checks remain strict instead of hiding a broken distribution.
      await expect(loadIntegrations(root)).rejects.toMatchObject({ code: 'invalid_manifest' });
    },
  );

  it.each([
    ['binding', 'binding.py'],
    ['probe', 'probe.py'],
  ] as const)('rejects a manifest whose %s is not an allowed file type', async (field, value) => {
    const root = await fixtureRoot();
    const directory = await integration(root, 'typed');
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    manifest.operations[0][field] = value;
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await expect(loadIntegrations(root)).rejects.toMatchObject({ code: 'invalid_manifest' });
  });

  it('rejects a legacy manifest that still declares a Python entrypoint', async () => {
    const root = await fixtureRoot();
    const directory = await integration(root, 'legacy');
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    manifest.entrypoint = 'adapter.py';
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await expect(loadIntegrations(root)).rejects.toMatchObject({ code: 'invalid_manifest' });
  });

  it('withholds every owner of a colliding public name while keeping unrelated packages', async () => {
    const root = await fixtureRoot();
    await integration(root, 'alpha_beta', 'read');
    await integration(root, 'alpha', 'beta_read');
    await integration(root, 'healthy');
    const errors: IntegrationLoadFailure[] = [];
    const packages = await loadIntegrations(root, { onError: (error) => errors.push(error) });
    expect(packages.map((entry) => entry.manifest.id)).toEqual(['healthy']);
    expect(errors.map((failure) => failure.id).sort()).toEqual(['alpha', 'alpha_beta']);
    expect(errors.every((failure) => failure.error.code === 'duplicate_tool')).toBe(true);
    await expect(loadIntegrations(root)).rejects.toMatchObject({ code: 'duplicate_tool' });
  });

  it('does not reserve public names for a package that failed binding validation', async () => {
    const root = await fixtureRoot();
    const broken = await integration(root, 'alpha', 'beta_read');
    await integration(root, 'alpha_beta', 'read');
    await rm(join(broken, 'binding.js'));
    const errors: IntegrationLoadFailure[] = [];
    const packages = await loadIntegrations(root, { onError: (error) => errors.push(error) });
    expect(packages.map((entry) => entry.manifest.id)).toEqual(['alpha_beta']);
    expect(errors.map((failure) => failure.id)).toEqual(['alpha']);
    expect(errors[0]?.error.code).toBe('invalid_manifest');
  });

  it('withdraws earlier operations when activation of their package fails', async () => {
    const root = await fixtureRoot();
    const broken = await integration(root, 'broken');
    await integration(root, 'healthy');
    const manifest = JSON.parse(await readFile(join(broken, 'manifest.json'), 'utf8'));
    manifest.operations.push({
      ...manifest.operations[0],
      id: 'invalid',
      inputSchema: { type: 'not-a-json-schema-type' },
    });
    await writeFile(join(broken, 'manifest.json'), JSON.stringify(manifest));
    const manager = new IntegrationManager({
      targetId: 'activation',
      packageRoot: root,
      execute: async (script) => (script.includes('ready') ? { ready: true } : { ok: true }),
    });
    try {
      await manager.reconcile({
        foundryVersion: 'test',
        system: { id: 'custom-system', version: 'test' },
        modules: ['broken', 'healthy'].map((id) => ({ id, version: 'test', active: true })),
      });
      expect(manager.has('module_broken_read')).toBe(false);
      expect(manager.has('module_healthy_read')).toBe(true);
      expect(manager.list().find((entry) => entry.id === 'broken')).toMatchObject({
        state: 'error',
        operations: [{ available: false }, { available: false }],
      });
    } finally {
      await manager.close();
    }
  });

  it('reports a broken unrelated system and still executes an independent module', async () => {
    const root = await fixtureRoot();
    const missingManifest = join(root, 'systems', 'unused-system');
    await mkdir(missingManifest, { recursive: true });
    await integration(root, 'healthy');
    const manager = new IntegrationManager({
      targetId: 'world',
      packageRoot: root,
      execute: async (script) => (script.includes('ready') ? { ready: true } : { ok: true }),
    });
    try {
      await manager.reconcile({
        foundryVersion: 'test',
        system: { id: 'custom-system', version: 'test' },
        modules: [{ id: 'healthy', version: 'test', active: true }],
      });
      expect(manager.list().find((entry) => entry.id === 'unused-system')).toMatchObject({
        state: 'error',
        operations: [],
      });
      expect(manager.has('module_healthy_read')).toBe(true);
      await expect(manager.call('module_healthy_read', {})).resolves.toEqual({ ok: true });
    } finally {
      await manager.close();
    }
  });
});
