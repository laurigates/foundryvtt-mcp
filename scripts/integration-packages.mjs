/** Offline package discovery shared by checkout tooling. No integration IDs are registered here. */
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Script } from 'node:vm';

export const INTEGRATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function parseGeneration(value) {
  const generation = typeof value === 'number' ? value : /^\d+$/.test(value ?? '') ? Number(value) : NaN;
  if (!Number.isSafeInteger(generation) || generation < 13 || String(generation) !== String(value)) {
    throw new Error('Foundry generation must be a canonical integer of at least 13');
  }
  return generation;
}

async function readDirectory(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function exactDirectory(directory) {
  if (await realpath(directory) !== directory || !(await stat(directory)).isDirectory()) {
    throw new Error(`Integration directory may not alias another path: ${directory}`);
  }
}

export async function containedFile(root, filename) {
  if (typeof filename !== 'string' || !filename || isAbsolute(filename) || filename.includes('\\') || filename.split('/').includes('..')) {
    throw new Error(`Integration file must be a relative path: ${String(filename)}`);
  }
  const resolved = await realpath(join(root, filename));
  const inside = relative(root, resolved);
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside) || !(await stat(resolved)).isFile()) {
    throw new Error(`Integration file escapes its package: ${filename}`);
  }
  return resolved;
}

export async function validatePackageFiles(pkg) {
  const { root, manifest } = pkg;
  await containedFile(root, 'manifest.json');
  await containedFile(root, 'README.md');
  const entrypoint = await containedFile(root, manifest.entrypoint);
  if (!entrypoint.endsWith('.py')) throw new Error(`Adapter entrypoint must be Python: ${root}`);
  if (manifest.schemaVersion !== 1 || manifest.protocolVersion !== 1 ||
      typeof manifest.adapterVersion !== 'string' || !manifest.adapterVersion ||
      !/^\d{4}-\d{2}-\d{2}$/.test(manifest.updatedAt) ||
      !['experimental', 'supported'].includes(manifest.status) ||
      !manifest.upstream || !manifest.compatibility ||
      !Array.isArray(manifest.operations) || manifest.operations.length === 0) {
    throw new Error(`Invalid integration manifest metadata: ${root}`);
  }
  const operations = new Set();
  for (const operation of manifest.operations) {
    if (!/^[a-z][a-z0-9_]*$/.test(operation.id) || operations.has(operation.id) ||
        typeof operation.description !== 'string' || !operation.description ||
        typeof operation.readOnly !== 'boolean' || !operation.inputSchema || !operation.outputSchema ||
        typeof operation.inputSchema !== 'object' || Array.isArray(operation.inputSchema) ||
        typeof operation.outputSchema !== 'object' || Array.isArray(operation.outputSchema)) {
      throw new Error(`Invalid or duplicate integration operation in ${root}`);
    }
    const toolName = `${manifest.kind}_${manifest.id}_${operation.id}`;
    if (toolName.length > 128) throw new Error(`Integration tool name is too long: ${toolName}`);
    operations.add(operation.id);
    for (const field of ['binding', 'probe']) {
      const file = await containedFile(root, operation[field]);
      const source = await readFile(file, 'utf8');
      new Script(`(async () => {\n${source}\n})()`, { filename: file });
    }
  }
}

export async function discoverIntegrationPackages(packageRoot) {
  const root = await realpath(packageRoot);
  const packages = [];
  for (const [directory, kind] of [['systems', 'system'], ['modules', 'module']]) {
    const family = join(root, directory);
    const entries = await readDirectory(family);
    if (!entries.length) continue;
    await exactDirectory(family);
    for (const entry of entries) {
      if (entry.name.startsWith('.') || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
      const id = entry.name;
      if (!INTEGRATION_ID.test(id)) throw new Error(`Invalid integration directory: ${id}`);
      const identityRoot = join(family, id);
      await exactDirectory(identityRoot);
      const children = await readDirectory(identityRoot);
      const flat = children.some((child) => child.name === 'manifest.json');
      const generations = children.filter((child) => /^\d+$/.test(child.name) && (child.isDirectory() || child.isSymbolicLink()));
      if (flat && generations.length) throw new Error(`Ambiguous flat and generation layout: ${identityRoot}`);
      const variants = generations.length
        ? generations.map((child) => ({ root: join(identityRoot, child.name), foundryGeneration: parseGeneration(child.name) }))
        : [{ root: identityRoot }];
      for (const variant of variants) {
        await exactDirectory(variant.root);
        const manifest = JSON.parse(await readFile(await containedFile(variant.root, 'manifest.json'), 'utf8'));
        if (manifest.kind !== kind || manifest.id !== id || manifest.foundryGeneration !== variant.foundryGeneration) {
          throw new Error(`Folder and manifest identity/generation differ: ${variant.root}`);
        }
        packages.push({ ...variant, kind, id, manifest, relativeRoot: relative(root, variant.root).split(sep).join('/') });
      }
    }
  }
  return packages;
}

export function selectPackages(packages, filters = {}) {
  return packages.filter((pkg) =>
    (filters.kind === undefined || filters.kind === pkg.kind) &&
    (filters.id === undefined || filters.id === pkg.id) &&
    (filters.foundryGeneration === undefined || filters.foundryGeneration === pkg.foundryGeneration));
}
