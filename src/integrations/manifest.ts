import { readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
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

const OperationSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    description: z.string().min(1),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    binding: RelativeFile,
    probe: RelativeFile,
    readOnly: z.boolean(),
  })
  .strict();

export const IntegrationManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    protocolVersion: z.literal(1),
    kind: z.enum(['system', 'module']),
    id: Identifier,
    adapterVersion: z.string().min(1),
    updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    entrypoint: RelativeFile,
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
    let entries: string[];
    try {
      entries = await readdir(family);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
    for (const id of entries.sort()) {
      if (typeof id !== 'string' || id.startsWith('.') || id === 'README.md') {
        continue;
      }
      const root = resolve(family, id);
      let manifest: IntegrationManifest | undefined;
      const names: string[] = [];
      try {
        const familyRoot = await realpath(family);
        const resolvedRoot = await realpath(root);
        const relativeRoot = relative(familyRoot, resolvedRoot);
        if (relativeRoot.startsWith('..') || isAbsolute(relativeRoot)) {
          throw new IntegrationError(
            'invalid_manifest',
            `Integration directory escapes ${directory}: ${id}`,
          );
        }
        const data: unknown = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
        manifest = IntegrationManifestSchema.parse(data);
        if (manifest.kind !== kind || manifest.id !== id) {
          throw new IntegrationError(
            'invalid_manifest',
            `Folder and manifest identity differ: ${directory}/${id}`,
          );
        }
        await containedFile(root, manifest.entrypoint);
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
        if (!manifest && error instanceof Error && 'code' in error && error.code === 'ENOTDIR') {
          continue;
        }
        failures.push({
          kind,
          id,
          adapterVersion: manifest?.adapterVersion ?? 'unknown',
          operations: [...new Set(names)],
          error:
            error instanceof IntegrationError
              ? error
              : new IntegrationError(
                  'invalid_manifest',
                  `Cannot load ${directory}/${id}: ${error instanceof Error ? error.message : String(error)}`,
                ),
        });
      }
    }
  }

  // Only fully validated packages own names. All owners of a collision are withheld,
  // rather than letting directory order silently choose an implementation.
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
    if (entries.length < 2) {
      continue;
    }
    for (const entry of entries) {
      const names = conflicts.get(entry) ?? [];
      names.push(name);
      conflicts.set(entry, names);
    }
  }
  for (const [entry, names] of conflicts) {
    failures.push({
      kind: entry.manifest.kind,
      id: entry.manifest.id,
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
