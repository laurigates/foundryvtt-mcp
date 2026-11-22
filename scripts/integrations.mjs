#!/usr/bin/env node
/** Build and test every independent integration variant in a project checkout. */
import { spawnSync } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { containedFile, discoverIntegrationPackages, parseGeneration, selectPackages, validatePackageFiles } from './integration-packages.mjs';

const checkoutRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(args, cwd) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Integration command failed (${result.status ?? result.signal}): ${args.join(' ')}`);
}

async function optionalFile(root, filename) {
  try { await access(join(root, filename)); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  return containedFile(root, filename);
}

export async function runIntegrationCommand(action, { packageRoot = checkoutRoot, filters = {}, includeToolingTests = true } = {}) {
  if (!['check', 'generate', 'test'].includes(action)) throw new Error('Expected check, generate, or test');
  const packages = selectPackages(await discoverIntegrationPackages(packageRoot), filters);
  if (!packages.length) throw new Error('No integration packages matched the selection');
  for (const pkg of packages) {
    const build = await optionalFile(pkg.root, 'build.mjs');
    if (build) run([build, action === 'generate' ? '--write' : '--check'], pkg.root);
    pkg.manifest = JSON.parse(await readFile(await containedFile(pkg.root, 'manifest.json'), 'utf8'));
    if (pkg.manifest.kind !== pkg.kind || pkg.manifest.id !== pkg.id || pkg.manifest.foundryGeneration !== pkg.foundryGeneration) {
      throw new Error(`Generated manifest identity/generation differs: ${pkg.root}`);
    }
    // Manifest-only packages are supported; every package still needs intact,
    // contained files. Full Zod/Ajv validation belongs to the host schema tests.
    await validatePackageFiles(pkg);
  }
  if (action === 'test') {
    const files = [];
    for (const pkg of packages) {
      let entries;
      try { entries = await readdir(join(pkg.root, 'tests')); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      for (const name of entries.sort()) {
        if (name.endsWith('.test.mjs')) files.push(await containedFile(pkg.root, `tests/${name}`));
      }
    }
    if (includeToolingTests && Object.keys(filters).length === 0) {
      const directory = join(checkoutRoot, 'scripts/tests');
      for (const name of (await readdir(directory)).sort()) {
        if (name.endsWith('.test.mjs')) files.push(join(directory, name));
      }
    }
    if (files.length) run(['--test', ...files], packageRoot);
    console.log(`Integration binding tests selected ${files.length} test files.`);
  }
  console.log(`${action}: ${packages.length} independent integration packages checked.`);
  return packages.length;
}

export function parseArguments(argv) {
  const [action, ...rest] = argv;
  const filters = {};
  for (let index = 0; index < rest.length; index += 2) {
    const option = rest[index];
    const value = rest[index + 1];
    if (!value || !['--kind', '--id', '--foundry'].includes(option)) throw new Error(`Invalid option: ${option ?? ''}`);
    const field = option === '--foundry' ? 'foundryGeneration' : option.slice(2);
    if (field in filters) throw new Error(`Duplicate option: ${option}`);
    filters[field] = field === 'foundryGeneration' ? parseGeneration(value) : value;
  }
  if (filters.kind !== undefined && !['system', 'module'].includes(filters.kind)) throw new Error('--kind must be system or module');
  return { action, filters };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { action, filters } = parseArguments(process.argv.slice(2));
    await runIntegrationCommand(action, { filters });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
