/** System-owned display/validation descriptors; unknown systems keep their raw data. */
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { FoundryActor, FoundryItem, WorldActor, WorldItem } from '../foundry/types.js';
import { defaultPackageRoot, IntegrationManifestSchema } from '../integrations/manifest.js';
import { parseFoundryGeneration } from '../integrations/types.js';
import type { AttributePatch } from './types.js';

const BoundSchema = z.object({
  path: z.string().optional(),
  pattern: z.string().optional(),
  label: z.string().default('attribute'),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  maximumPath: z.string().optional(),
  addPath: z.string().optional(),
  fallbackMaximum: z.string().optional(),
  fallbackAdd: z.string().optional(),
  maximumLabel: z.string().default('max'),
  overrides: z
    .array(
      z.object({ paths: z.array(z.string()), values: z.array(z.string()), maximum: z.number() }),
    )
    .default([]),
});
const ProjectionSchema = z.object({
  version: z.literal(1),
  fields: z.record(z.string(), z.string()).default({}),
  itemFields: z.record(z.string(), z.string()).default({}),
  abilities: z.string().optional(),
  bounds: z.array(BoundSchema).default([]),
});
type Projection = z.infer<typeof ProjectionSchema>;
const descriptors = new Map<string, { stamp: string; projection: Projection }>();

function descriptor(
  systemId: string,
  foundryVersion: string | undefined,
  packageRoot = defaultPackageRoot(),
): Projection | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(systemId)) {
    return null;
  }
  try {
    const familyPath = resolve(realpathSync(packageRoot), 'systems');
    const family = realpathSync(familyPath);
    const systemPath = resolve(family, systemId);
    const systemRoot = realpathSync(systemPath);
    const inside = (root: string, path: string) => {
      const suffix = relative(root, path);
      return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
    };
    if (family !== resolve(familyPath) || systemRoot !== systemPath || !inside(family, systemRoot)) {
      throw new Error('System projection directory escapes the systems directory');
    }
    const entries = readdirSync(systemRoot, { withFileTypes: true });
    const versioned = entries.some(
      (entry) => /^\d+$/.test(entry.name) && (entry.isDirectory() || entry.isSymbolicLink()),
    );
    const generation =
      foundryVersion === undefined ? undefined : parseFoundryGeneration(foundryVersion);
    // A versioned family never falls back to another generation or a flat descriptor.
    // Unknown generations retain raw document data; legacy flat packages still work.
    if (
      versioned &&
      (generation === undefined ||
        generation < 13 ||
        entries.some((entry) => entry.name === 'manifest.json'))
    ) {
      return null;
    }
    if (
      versioned &&
      !entries.some(
        (entry) =>
          entry.name === String(generation) && (entry.isDirectory() || entry.isSymbolicLink()),
      )
    ) {
      return null;
    }
    const expectedRoot = versioned ? resolve(systemRoot, String(generation)) : systemRoot;
    const root = realpathSync(expectedRoot);
    if (root !== expectedRoot) {
      throw new Error('A generation projection cannot alias a different directory');
    }
    const path = realpathSync(resolve(root, 'actor-projection.json'));
    const manifestPath = realpathSync(resolve(root, 'manifest.json'));
    if (!inside(systemRoot, root) || !inside(root, path) || !inside(root, manifestPath)) {
      throw new Error('System projection escapes its generation directory');
    }
    const stat = statSync(path, { bigint: true });
    const manifestStat = statSync(manifestPath, { bigint: true });
    const stamp = `${stat.ino}:${stat.mtimeNs}:${stat.size}:${manifestStat.ino}:${manifestStat.mtimeNs}:${manifestStat.size}`;
    const cached = descriptors.get(path);
    if (cached?.stamp === stamp) {
      return cached.projection;
    }
    // A missing or misidentified manifest cannot contribute system-specific fields
    // or validation bounds to a different generation.
    let source: unknown;
    try {
      source = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      return null;
    }
    const manifest = IntegrationManifestSchema.safeParse(source);
    if (
      !manifest.success ||
      manifest.data.kind !== 'system' ||
      manifest.data.id !== systemId ||
      manifest.data.foundryGeneration !== (versioned ? generation : undefined)
    ) {
      return null;
    }
    const parsed = ProjectionSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    descriptors.set(path, { stamp, projection: parsed });
    return parsed;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    ) {
      return null;
    }
    throw new Error(`Invalid actor projection for system '${systemId}'`, { cause: error });
  }
}

export function readPath(object: unknown, path: string | undefined): unknown {
  if (!path) {
    return undefined;
  }
  let value: unknown = object;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      return undefined;
    }
    value = Reflect.get(value, key);
  }
  return value;
}

export function projectActor(
  raw: WorldActor,
  systemId: string,
  foundryVersion?: string,
  packageRoot?: string,
): FoundryActor {
  const actor: FoundryActor = { _id: raw._id, name: raw.name, type: raw.type, data: raw.system };
  if (raw.img) {
    actor.img = raw.img;
  }
  const config = descriptor(systemId, foundryVersion, packageRoot);
  if (!config) {
    return actor;
  }
  const value = (field: string) => readPath(raw.system, config.fields[field]);
  const hpValue = value('hpValue');
  const hpMax = value('hpMax');
  const hpTemp = value('hpTemp');
  // Preserve partial numeric HP data; missing fields must not erase present values.
  const hp: { value?: number; max?: number; temp?: number } = {};
  if (typeof hpValue === 'number') {
    hp.value = hpValue;
  }
  if (typeof hpMax === 'number') {
    hp.max = hpMax;
  }
  if (typeof hpTemp === 'number') {
    hp.temp = hpTemp;
  }
  if (Object.keys(hp).length > 0) {
    actor.hp = hp;
  }
  const ac = value('ac');
  if (typeof ac === 'number') {
    actor.ac = { value: ac };
  }
  const level = value('level');
  if (typeof level === 'number') {
    actor.level = level;
  }
  const bio = value('biography');
  if (typeof bio === 'string') {
    actor.biography = bio;
  }
  const abilities = readPath(raw.system, config.abilities);
  if (abilities !== null && typeof abilities === 'object' && !Array.isArray(abilities)) {
    actor.abilities = {};
    for (const [key, entry] of Object.entries(abilities)) {
      const score = readPath(entry, 'value');
      const modifier = readPath(entry, 'mod');
      const save = readPath(entry, 'save');
      if (typeof score !== 'number' || typeof modifier !== 'number') {
        continue;
      }
      actor.abilities[key] = { value: score, mod: modifier };
      if (typeof save === 'number') {
        actor.abilities[key].save = save;
      }
    }
  }
  return actor;
}

export function projectItem(
  raw: WorldItem,
  systemId: string,
  foundryVersion?: string,
  packageRoot?: string,
): FoundryItem {
  const item: FoundryItem = { _id: raw._id, name: raw.name, type: raw.type, data: raw.system };
  if (raw.img) {
    item.img = raw.img;
  }
  const config = descriptor(systemId, foundryVersion, packageRoot);
  if (!config) {
    return item;
  }
  const description = readPath(raw.system, config.itemFields.description);
  const rarity = readPath(raw.system, config.itemFields.rarity);
  if (typeof description === 'string') {
    item.description = description;
  }
  if (typeof rarity === 'string') {
    item.rarity = rarity;
  }
  return item;
}

export function validateSystemPatch(
  patch: AttributePatch,
  actor: FoundryActor,
  rawSystem: Record<string, unknown> | undefined,
  systemId: string,
  foundryVersion?: string,
  packageRoot?: string,
): void {
  const config = descriptor(systemId, foundryVersion, packageRoot);
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split('.');
    if (
      parts.some(
        (part) =>
          !/^[a-zA-Z0-9_-]+$/.test(part) ||
          ['__proto__', 'constructor', 'prototype'].includes(part),
      )
    ) {
      throw new Error(`Invalid attribute path: ${path}`);
    }
    if (
      !['string', 'boolean', 'number'].includes(typeof value) ||
      (typeof value === 'number' && !Number.isFinite(value))
    ) {
      throw new Error(`Attribute '${path}' must be a finite scalar value`);
    }
    for (const rule of config?.bounds ?? []) {
      const match = rule.pattern ? new RegExp(rule.pattern).exec(path) : null;
      if (rule.path !== path && !match) {
        continue;
      }
      if (typeof value !== 'number') {
        continue;
      }
      const expand = (template: string | undefined) =>
        template?.replace(/\$(\d+)/g, (_all, index: string) => match?.[Number(index)] ?? '');
      let maximum = rule.maximum;
      const limit =
        readPath(rawSystem, expand(rule.maximumPath)) ?? readPath(actor, rule.fallbackMaximum);
      if (typeof limit === 'number') {
        maximum = limit;
      }
      const addPath = expand(rule.addPath);
      const add =
        (addPath ? patch[addPath] : undefined) ??
        readPath(rawSystem, addPath) ??
        readPath(actor, rule.fallbackAdd) ??
        0;
      if (maximum !== undefined && typeof add === 'number') {
        maximum += add;
      }
      for (const override of rule.overrides) {
        if (
          override.paths.some((candidate) =>
            override.values.includes(String(readPath(rawSystem, candidate))),
          )
        ) {
          maximum = override.maximum;
        }
      }
      if (
        (rule.minimum !== undefined && value < rule.minimum) ||
        (maximum !== undefined && value > maximum)
      ) {
        if (rule.minimum !== undefined && maximum !== undefined) {
          throw new Error(
            `Invalid ${rule.label} ${value}: must be between ${rule.minimum} and ${maximum}`,
          );
        }
        throw new Error(
          `Invalid ${rule.label} ${value}: exceeds ${rule.maximumLabel} (${maximum})`,
        );
      }
    }
    // A real snapshot can validate the field; synthetic compatibility callers
    // with no system data remain shape-validated only.
    if (rawSystem && Object.keys(rawSystem).length > 0 && readPath(rawSystem, path) === undefined) {
      throw new Error(`Unknown attribute path: ${path}`);
    }
  }
}
