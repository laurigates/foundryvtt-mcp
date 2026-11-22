import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorldActor, WorldItem } from '../../foundry/types.js';
import { projectActor, projectItem, validateSystemPatch } from '../projections.js';

const roots: string[] = [];
const systemId = 'projection-fixture';
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'foundry-projections-'));
  roots.push(root);
  return root;
}

function manifest(generation?: number, id = systemId): Record<string, unknown> {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    kind: 'system',
    id,
    ...(generation === undefined ? {} : { foundryGeneration: generation }),
    adapterVersion: 'fixture',
    updatedAt: '2026-11-22',
    entrypoint: 'adapter.py',
    status: 'experimental',
    upstream: { repository: null, reference: null, updatedAt: null, verifiedAt: null },
    compatibility: { foundryVersions: [], integrationVersions: [], tested: [] },
    operations: [{
      id: 'read',
      description: 'Read fixture data',
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: { type: 'object', additionalProperties: true },
      binding: 'binding.js',
      probe: 'probe.js',
      readOnly: true,
    }],
  };
}

function descriptor(field: 'old' | 'current', maximum: number) {
  return {
    version: 1,
    fields: { hpValue: `${field}.hp`, hpMax: `${field}.max` },
    itemFields: { description: `${field}.description`, rarity: `${field}.rarity` },
    bounds: [{ path: 'attributes.resource', minimum: 0, maximum, label: 'fixture resource' }],
  };
}

async function fixture(
  root: string,
  generation?: number,
  { field = generation === 14 ? 'current' : 'old', maximum = generation === 14 ? 10 : 6,
    id = systemId }: { field?: 'old' | 'current'; maximum?: number; id?: string } = {},
): Promise<string> {
  const identity = join(root, 'systems', id);
  const directory = generation === undefined ? identity : join(identity, String(generation));
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest(generation, id))),
    writeFile(join(directory, 'actor-projection.json'), JSON.stringify(descriptor(field, maximum))),
    writeFile(join(directory, 'README.md'), 'Projection fixture\n'),
    writeFile(join(directory, 'adapter.py'), 'class Adapter: pass\n'),
    writeFile(join(directory, 'binding.js'), 'return {};\n'),
    writeFile(join(directory, 'probe.js'), 'return {ready: true};\n'),
  ]);
  return directory;
}

function actor(): WorldActor {
  return {
    _id: 'hero', name: 'Hero', type: 'character', img: 'hero.webp',
    system: {
      old: { hp: 13, max: 26 },
      current: { hp: 14, max: 28 },
      attributes: { resource: 2 },
    },
  };
}

function item(): WorldItem {
  return {
    _id: 'item', name: 'Item', type: 'equipment',
    system: {
      old: { description: 'Generation 13', rarity: 'common' },
      current: { description: 'Generation 14', rarity: 'rare' },
    },
  };
}

function validate(root: string, version: string | undefined, value: number): void {
  const raw = actor();
  validateSystemPatch(
    { 'attributes.resource': value },
    projectActor(raw, systemId, version, root),
    raw.system,
    systemId,
    version,
    root,
  );
}

function expectRaw(root: string, version: string | undefined): void {
  const raw = actor();
  expect(projectActor(raw, systemId, version, root)).toEqual({
    _id: raw._id, name: raw.name, type: raw.type, img: raw.img, data: raw.system,
  });
  const rawItem = item();
  expect(projectItem(rawItem, systemId, version, root)).toEqual({
    _id: rawItem._id, name: rawItem.name, type: rawItem.type, data: rawItem.system,
  });
  expect(() => validate(root, version, 999)).not.toThrow();
  expect(() => validate(root, version, Number.NaN)).toThrow(/finite scalar/);
}

describe('generation-specific Actor and Item projections', () => {
  it('selects distinct fields and validation bounds for the exact generation', async () => {
    const root = await fixtureRoot();
    await fixture(root, 13);
    await fixture(root, 14);

    expect(projectActor(actor(), systemId, '13.350', root).hp).toEqual({ value: 13, max: 26 });
    expect(projectItem(item(), systemId, '13.350', root)).toMatchObject({
      description: 'Generation 13', rarity: 'common',
    });
    expect(() => validate(root, '13.350', 8)).toThrow(/between 0 and 6/);

    expect(projectActor(actor(), systemId, '14.370', root).hp).toEqual({ value: 14, max: 28 });
    expect(projectItem(item(), systemId, '14.370', root)).toMatchObject({
      description: 'Generation 14', rarity: 'rare',
    });
    expect(() => validate(root, '14.370', 8)).not.toThrow();
    expect(() => validate(root, '14.370', 11)).toThrow(/between 0 and 10/);

    // A later call for another target must still use the earlier generation's descriptor.
    expect(projectActor(actor(), systemId, '13.350', root).hp?.value).toBe(13);
    expect(() => validate(root, '13.350', 8)).toThrow(/between 0 and 6/);
  });

  it.each(['12.331', '15.400', 'unknown', undefined])(
    'retains raw data without borrowing a descriptor for Foundry %s', async (version) => {
      const root = await fixtureRoot();
      await fixture(root, 13);
      await fixture(root, 14);
      projectActor(actor(), systemId, '14.370', root);
      expectRaw(root, version);
    },
  );

  it('does not use an unselected sibling when only generation 13 exists', async () => {
    const root = await fixtureRoot();
    await fixture(root, 13);
    expectRaw(root, '14.370');
  });

  it('treats a numeric file as a missing variant without breaking core reads', async () => {
    const root = await fixtureRoot();
    await fixture(root, 13);
    await writeFile(join(root, 'systems', systemId, '14'), 'Not a package directory');
    expectRaw(root, '14.370');
  });

  it('treats a system-ID file as an absent projection package', async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, 'systems'));
    await writeFile(join(root, 'systems', systemId), 'Not a package directory');
    expectRaw(root, '14.370');
  });

  it('isolates cache entries for the same system and generation in different roots', async () => {
    const first = await fixtureRoot();
    const second = await fixtureRoot();
    await fixture(first, 14, { field: 'old', maximum: 6 });
    await fixture(second, 14, { field: 'current', maximum: 10 });
    expect(projectActor(actor(), systemId, '14.370', first).hp?.value).toBe(13);
    expect(projectActor(actor(), systemId, '14.370', second).hp?.value).toBe(14);
    expect(() => validate(first, '14.370', 8)).toThrow(/between 0 and 6/);
    expect(() => validate(second, '14.370', 8)).not.toThrow();
  });

  it('reloads fields and bounds after an in-place descriptor edit', async () => {
    const root = await fixtureRoot();
    const directory = await fixture(root, 14, { field: 'old', maximum: 6 });
    expect(projectActor(actor(), systemId, '14.370', root).hp?.value).toBe(13);
    expect(() => validate(root, '14.370', 50)).toThrow(/between 0 and 6/);

    // Different content length makes the cache-stamp change independent of clock resolution.
    await writeFile(join(directory, 'actor-projection.json'), JSON.stringify(descriptor('current', 1234)));
    expect(projectActor(actor(), systemId, '14.370', root).hp?.value).toBe(14);
    expect(projectItem(item(), systemId, '14.370', root).rarity).toBe('rare');
    expect(() => validate(root, '14.370', 50)).not.toThrow();
  });

  it('invalidates a cached descriptor when its manifest becomes mismatched, then recovers', async () => {
    const root = await fixtureRoot();
    const directory = await fixture(root, 14);
    const path = join(directory, 'manifest.json');
    expect(projectActor(actor(), systemId, '14.370', root).hp?.value).toBe(14);
    await writeFile(path, JSON.stringify({ ...manifest(14), id: 'different-identity-longer' }));
    expectRaw(root, '14.370');
    // Added JSON whitespace guarantees a fresh size even if filesystem timestamps are coarse.
    await writeFile(path, `${JSON.stringify(manifest(14))}\n  `);
    expect(projectActor(actor(), systemId, '14.370', root).hp?.value).toBe(14);
    expect(() => validate(root, '14.370', 11)).toThrow(/between 0 and 10/);
  });

  it.each([
    ['malformed JSON', '{'],
    ['invalid schema', JSON.stringify({ id: systemId })],
    ['wrong identity', JSON.stringify({ ...manifest(14), id: 'another-system' })],
    ['wrong kind', JSON.stringify({ ...manifest(14), kind: 'module' })],
    ['missing generation', JSON.stringify(manifest())],
    ['wrong generation', JSON.stringify(manifest(13))],
    ['string generation', JSON.stringify({ ...manifest(14), foundryGeneration: '14' })],
  ])('retains raw data for a %s manifest', async (_label, contents) => {
    const root = await fixtureRoot();
    const directory = await fixture(root, 14);
    await writeFile(join(directory, 'manifest.json'), contents);
    expectRaw(root, '14.370');
  });

  it('does not retain a cached projection after its manifest is removed', async () => {
    const root = await fixtureRoot();
    await fixture(root, 13);
    const directory = await fixture(root, 14);
    expect(projectActor(actor(), systemId, '14.370', root).hp?.value).toBe(14);
    await rm(join(directory, 'manifest.json'));
    expectRaw(root, '14.370');
  });

  it('rejects an aliased systems family directory', async () => {
    const root = await fixtureRoot();
    await fixture(root, 14);
    const original = join(root, 'systems');
    const moved = join(root, 'saved-systems');
    await rename(original, moved);
    await symlink(moved, original, 'dir');
    expect(() => projectActor(actor(), systemId, '14.370', root)).toThrow(/Invalid actor projection/);
  });

  it('rejects an identity directory aliased to another system', async () => {
    const root = await fixtureRoot();
    await fixture(root, 14, { id: 'original' });
    await symlink(join(root, 'systems/original'), join(root, 'systems', systemId), 'dir');
    expect(() => projectActor(actor(), systemId, '14.370', root)).toThrow(/Invalid actor projection/);
  });

  it('rejects a generation directory aliased to its sibling', async () => {
    const root = await fixtureRoot();
    const earlier = await fixture(root, 13);
    await symlink(earlier, join(root, 'systems', systemId, '14'), 'dir');
    expect(() => projectActor(actor(), systemId, '14.370', root)).toThrow(/Invalid actor projection/);
    expect(projectActor(actor(), systemId, '13.350', root).hp?.value).toBe(13);
  });

  it.each(['actor-projection.json', 'manifest.json'])(
    'rejects %s borrowed through a sibling-generation symlink', async (name) => {
      const root = await fixtureRoot();
      const earlier = await fixture(root, 13);
      const current = await fixture(root, 14);
      await rm(join(current, name));
      await symlink(join(earlier, name), join(current, name), 'file');
      expect(() => projectActor(actor(), systemId, '14.370', root)).toThrow(/Invalid actor projection/);
    },
  );

  it('keeps the original flat package behavior when no generation layout exists', async () => {
    const root = await fixtureRoot();
    await fixture(root);
    for (const version of [undefined, '13.350', '14.370', '15.400']) {
      expect(projectActor(actor(), systemId, version, root).hp?.value).toBe(13);
      expect(projectItem(item(), systemId, version, root).rarity).toBe('common');
      expect(() => validate(root, version, 8)).toThrow(/between 0 and 6/);
    }
  });

  it('withholds ambiguous flat plus versioned descriptors', async () => {
    const root = await fixtureRoot();
    await fixture(root);
    await fixture(root, 14);
    expectRaw(root, '14.370');
  });

  it('does not accept generation metadata in a flat manifest', async () => {
    const root = await fixtureRoot();
    const directory = await fixture(root);
    const path = join(directory, 'manifest.json');
    const current = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    await writeFile(path, JSON.stringify({ ...current, foundryGeneration: 14 }));
    expectRaw(root, '14.370');
  });
});
