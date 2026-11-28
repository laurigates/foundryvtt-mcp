import type { Dirent } from 'node:fs';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { IntegrationError, type IntegrationKind } from './types.js';

const Identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const RelativeFile = z
  .string()
  .min(1)
  .refine(
    (value) => !isAbsolute(value) && !value.includes('\\') && !value.split('/').includes('..'),
    'Entrypoints and bindings must be relative paths within the integration directory',
  );
/**
 * The host evaluates bindings and probes as JavaScript scripts, so the manifest
 * cannot point them at arbitrary package files.
 */
const JavaScriptBinding = RelativeFile.refine(
  (value) => value.toLowerCase().endsWith('.js'),
  'Bindings and probes must be .js files inside the integration directory',
);

const OperationSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    description: z.string().min(1),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    binding: JavaScriptBinding,
    probe: JavaScriptBinding,
    readOnly: z.boolean(),
  })
  .strict();

export const IntegrationManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    protocolVersion: z.literal(1),
    kind: z.enum(['system', 'module']),
    id: Identifier,
    foundryGeneration: z.number().int().min(13).max(Number.MAX_SAFE_INTEGER).optional(),
    adapterVersion: z.string().min(1),
    updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(['experimental', 'supported']),
    upstream: z
      .object({
        repository: z.string().nullable(),
        reference: z.string().nullable(),
        updatedAt: z.string().nullable(),
        verifiedAt: z.string().nullable(),
      })
      .strict(),
    compatibility: z
      .object({
        foundryVersions: z.array(z.string()),
        integrationVersions: z.array(z.string()),
        systems: z.array(z.string()).optional(),
        tested: z.array(
          z
            .object({
              foundry: z.string(),
              integration: z.string(),
              system: z.string().optional(),
              systemVersion: z.string().optional(),
            })
            .strict(),
        ),
      })
      .strict(),
    operations: z.array(OperationSchema).min(1),
  })
  .strict();

export type IntegrationManifest = z.infer<typeof IntegrationManifestSchema>;
export type IntegrationOperation = z.infer<typeof OperationSchema>;

export interface IntegrationPackage {
  root: string;
  manifest: IntegrationManifest;
  bindings: Map<string, { script: string; probe: string }>;
}

export interface IntegrationLoadFailure {
  kind: IntegrationKind;
  id: string;
  /** Folder generation, even when that variant's manifest failed validation. */
  foundryGeneration?: number;
  adapterVersion: string;
  operations: string[];
  error: IntegrationError;
}

export interface IntegrationLoadOptions {
  /** Runtime discovery can isolate bad packages; build/package checks remain strict by default. */
  onError?: (failure: IntegrationLoadFailure) => void;
}

/** Works from both src/integrations and the installed dist/integrations directory. */
export function defaultPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}

export function toolName(kind: IntegrationKind, id: string, operation: string): string {
  const name = `${kind}_${id}_${operation}`;
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.length > 128) {
    throw new IntegrationError('invalid_tool_name', `Invalid integration tool name: ${name}`);
  }
  return name;
}

/**
 * Stable relay identity for a package operation. The generation keeps two
 * variants of the same package distinct, because a relay holds the bindings of
 * every installed generation. A probe is the same operation with its own suffix.
 */
export function operationName(
  kind: IntegrationKind,
  id: string,
  generation: number | undefined,
  operation: string,
): string {
  const name = `${kind}.${id}.${generation === undefined ? '' : `${generation}.`}${operation}`;
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.length > 128) {
    throw new IntegrationError('invalid_tool_name', `Invalid integration operation name: ${name}`);
  }
  return name;
}

async function containedFile(root: string, path: string): Promise<string> {
  const base = await realpath(root);
  const file = await realpath(resolve(root, path));
  const inside = relative(base, file);
  if (inside.startsWith('..') || isAbsolute(inside)) {
    throw new IntegrationError(
      'invalid_manifest',
      `Integration file escapes its directory: ${path}`,
    );
  }
  return file;
}

async function containedDirectory(root: string, directory: string): Promise<void> {
  // Structural directory aliases can turn /14 into /13 or one identity into
  // another. Keep the canonical paths the loader resolves for every variant.
  const expected = resolve(await realpath(root), basename(directory));
  if ((await realpath(directory)) !== expected) {
    throw new IntegrationError(
      'invalid_manifest',
      `Integration directory escapes or aliases its expected path: ${directory}`,
    );
  }
}

export async function loadIntegrations(
  packageRoot = defaultPackageRoot(),
  options: IntegrationLoadOptions = {},
): Promise<IntegrationPackage[]> {
  const packages: IntegrationPackage[] = [];
  const failures: IntegrationLoadFailure[] = [];
  for (const [directory, kind] of [
    ['systems', 'system'],
    ['modules', 'module'],
  ] as const) {
    const family = resolve(packageRoot, directory);
    let entries: Dirent[];
    try {
      entries = await readdir(family, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
    for (const item of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const id = item.name;
      if (id.startsWith('.') || (!item.isDirectory() && !item.isSymbolicLink())) {
        continue;
      }
      const identityRoot = resolve(family, id);
      let variants: Array<{ root: string; foundryGeneration?: number }>;
      try {
        Identifier.parse(id);
        await containedDirectory(packageRoot, family);
        await containedDirectory(family, identityRoot);
        const contents = await readdir(identityRoot, { withFileTypes: true });
        const hasFlatManifest = contents.some((entry) => entry.name === 'manifest.json');
        const generationFolders = contents
          .filter(
            (entry) => /^\d+$/.test(entry.name) && (entry.isDirectory() || entry.isSymbolicLink()),
          )
          .sort((a, b) => a.name.localeCompare(b.name));
        if (hasFlatManifest && generationFolders.length > 0) {
          throw new IntegrationError(
            'ambiguous_layout',
            `Integration ${kind}:${id} contains both a flat manifest and generation directories`,
          );
        }
        // No numeric folders retains the original flat contract. A missing flat
        // manifest remains an error rather than silently ignoring an empty package.
        variants = generationFolders.length
          ? generationFolders.map((entry) => ({
              root: resolve(identityRoot, entry.name),
              foundryGeneration: Number(entry.name),
            }))
          : [{ root: identityRoot }];
      } catch (error) {
        failures.push({
          kind,
          id,
          adapterVersion: 'unknown',
          operations: [],
          error:
            error instanceof IntegrationError
              ? error
              : new IntegrationError(
                  'invalid_manifest',
                  `Cannot load ${directory}/${id}: ${error instanceof Error ? error.message : String(error)}`,
                ),
        });
        continue;
      }
      for (const { root, foundryGeneration } of variants) {
        let manifest: IntegrationManifest | undefined;
        const names: string[] = [];
        try {
          if (foundryGeneration !== undefined) {
            if (
              !Number.isSafeInteger(foundryGeneration) ||
              foundryGeneration < 13 ||
              root !== resolve(identityRoot, String(foundryGeneration))
            ) {
              throw new IntegrationError(
                'invalid_manifest',
                `Invalid Foundry generation directory: ${root}`,
              );
            }
            await containedDirectory(identityRoot, root);
          }
          const data: unknown = JSON.parse(
            await readFile(await containedFile(root, 'manifest.json'), 'utf8'),
          );
          manifest = IntegrationManifestSchema.parse(data);
          if (
            manifest.kind !== kind ||
            manifest.id !== id ||
            manifest.foundryGeneration !== foundryGeneration
          ) {
            throw new IntegrationError(
              'invalid_manifest',
              `Folder and manifest identity/generation differ: ${root}`,
            );
          }
          await containedFile(root, 'README.md');
          const bindings = new Map<string, { script: string; probe: string }>();
          for (const operation of manifest.operations) {
            const name = toolName(kind, id, operation.id);
            if (bindings.has(operation.id)) {
              throw new IntegrationError('duplicate_tool', `Duplicate integration tool: ${name}`);
            }
            names.push(name);
            bindings.set(operation.id, {
              script: await readFile(await containedFile(root, operation.binding), 'utf8'),
              probe: await readFile(await containedFile(root, operation.probe), 'utf8'),
            });
          }
          packages.push({ root, manifest, bindings });
        } catch (error) {
          failures.push({
            kind,
            id,
            ...(foundryGeneration === undefined ? {} : { foundryGeneration }),
            adapterVersion: manifest?.adapterVersion ?? 'unknown',
            operations: [...new Set(names)],
            error:
              error instanceof IntegrationError
                ? error
                : new IntegrationError(
                    'invalid_manifest',
                    `Cannot load ${root}: ${error instanceof Error ? error.message : String(error)}`,
                  ),
          });
        }
      }
    }
  }

  // Different exact generations cannot activate together in one target. Legacy
  // packages can, so they overlap every generation. All overlapping owners are
  // withheld; neither directory order nor a preferred layout chooses a winner.
  const owners = new Map<string, IntegrationPackage[]>();
  for (const entry of packages) {
    for (const operation of entry.manifest.operations) {
      const name = toolName(entry.manifest.kind, entry.manifest.id, operation.id);
      const existing = owners.get(name) ?? [];
      existing.push(entry);
      owners.set(name, existing);
    }
  }
  const conflicts = new Map<IntegrationPackage, string[]>();
  for (const [name, entries] of owners) {
    for (const entry of entries) {
      const overlaps = entries.some(
        (other) =>
          other !== entry &&
          (entry.manifest.foundryGeneration === undefined ||
            other.manifest.foundryGeneration === undefined ||
            entry.manifest.foundryGeneration === other.manifest.foundryGeneration),
      );
      if (!overlaps) {
        continue;
      }
      const names = conflicts.get(entry) ?? [];
      names.push(name);
      conflicts.set(entry, names);
    }
  }
  for (const [entry, names] of conflicts) {
    failures.push({
      kind: entry.manifest.kind,
      id: entry.manifest.id,
      ...(entry.manifest.foundryGeneration === undefined
        ? {}
        : { foundryGeneration: entry.manifest.foundryGeneration }),
      adapterVersion: entry.manifest.adapterVersion,
      operations: entry.manifest.operations.map((operation) =>
        toolName(entry.manifest.kind, entry.manifest.id, operation.id),
      ),
      error: new IntegrationError(
        'duplicate_tool',
        `Conflicting integration tools: ${names.join(', ')}`,
      ),
    });
  }
  for (const failure of failures) {
    if (!options.onError) {
      throw failure.error;
    }
    options.onError(failure);
  }
  return packages.filter((entry) => !conflicts.has(entry));
}
