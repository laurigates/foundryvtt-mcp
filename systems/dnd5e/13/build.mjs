#!/usr/bin/env node
/** Autonomous generation-13 package; scripts retain the original public contract. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { metadata, legacyOperation, legacyBinding, legacyProbe } from './src/registry.mjs';

export const packageRoot = dirname(fileURLToPath(import.meta.url));
export function generatedFiles() {
  if (metadata.foundryGeneration !== 13 || metadata.kind !== 'system' || legacyOperation.id !== 'get_actor_data' || !legacyOperation.readOnly) {
    throw new Error('The Foundry 13 package must retain its single legacy Actor read');
  }
  for (const source of [legacyBinding, legacyProbe]) new Script(`(async () => {\n${source}\n})()`);
  return new Map([
    ['manifest.json', JSON.stringify({ ...metadata, operations: [legacyOperation] }, null, 2) + '\n'],
    ['get_actor_data.js', legacyBinding],
    ['probe.js', legacyProbe],
  ]);
}
export async function generatePackage({ mode = 'check', root = packageRoot } = {}) {
  if (!['check', 'write'].includes(mode)) throw new Error(`Unknown generation mode: ${mode}`);
  const files = generatedFiles();
  const differences = [];
  if (mode === 'write') await mkdir(root, { recursive: true });
  for (const [name, contents] of files) {
    if (mode === 'write') await writeFile(join(root, name), contents);
    else {
      try { if (await readFile(join(root, name), 'utf8') !== contents) differences.push(`changed: ${name}`); }
      catch (error) { if (error.code === 'ENOENT') differences.push(`missing: ${name}`); else throw error; }
    }
  }
  if (differences.length) throw new Error(`Generation-13 package is out of date:\n${differences.join('\n')}\nRun node build.mjs --write from the package directory`);
  return { operations: 1, files: files.size };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--write', '--check'].includes(args[0])) throw new Error('Usage: node build.mjs --write|--check');
  const result = await generatePackage({ mode: args[0].slice(2) });
  console.log(`${metadata.id}/13 ${args[0]}: ${result.operations} operation, ${result.files} generated files`);
}
