/** Compatibility mappers for the historical D&D-oriented client API.
 * Active providers use system/generation projection descriptors instead.
 */
import {
  abilityModifier,
  characterClassLevel,
  flatArmorClass,
  proficiencyBonus,
} from './dnd5e-derived.js';
import type {
  DerivedActorField,
  FoundryActor,
  FoundryItem,
  FoundryWorld,
  WorldActor,
  WorldData,
  WorldItem,
} from './types.js';

/** A Socket.IO world (or actor-owned) item → {@link FoundryItem}. */
export function worldItemToFoundry(i: WorldItem): FoundryItem {
  const item: FoundryItem = {
    _id: i._id,
    name: i.name,
    type: i.type,
  };
  if (i.img) {
    item.img = i.img;
  }
  const desc = extractString(i.system, 'description', 'value');
  if (desc) {
    item.description = desc;
  }
  const rar = extractString(i.system, 'rarity');
  if (rar) {
    item.rarity = rar;
  }
  return item;
}

/** The Socket.IO world snapshot's world, system and release data → {@link FoundryWorld}. */
export function worldInfoToFoundry(worldData: WorldData): FoundryWorld {
  const w = worldData.world as Record<string, unknown>;
  const s = worldData.system as Record<string, unknown>;
  const r = worldData.release as Record<string, unknown>;

  return {
    id: (w.id as string) || 'unknown',
    title: (w.title as string) || 'Unknown World',
    description: (w.description as string) || '',
    system: (s.id as string) || 'unknown',
    coreVersion: (r.version as string) || (r.generation as string) || 'unknown',
    systemVersion: (s.version as string) || 'unknown',
    playtime: 0,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
  };
}

export function worldActorToFoundry(a: WorldActor): FoundryActor {
  const sys = a.system || {};
  const hpRaw = extractNested(sys, 'attributes', 'hp');
  const hp = isRecord(hpRaw) ? hpRaw : undefined;
  const acRaw = extractNested(sys, 'attributes', 'ac');
  const ac = isRecord(acRaw) ? acRaw : undefined;
  const details = isRecord(sys.details) ? sys.details : {};

  const abilitiesRaw = sys.abilities;
  let mappedAbilities: FoundryActor['abilities'];
  if (isRecord(abilitiesRaw)) {
    mappedAbilities = {};
    for (const [key, val] of Object.entries(abilitiesRaw)) {
      if (isRecord(val)) {
        const value = typeof val.value === 'number' ? val.value : 10;
        const entry: { value: number; mod: number; save?: number } = {
          value,
          // dnd5e source data has no `mod`; it is exact from the score (#308).
          mod: typeof val.mod === 'number' ? val.mod : abilityModifier(value),
        };
        if (typeof val.save === 'number') {
          entry.save = val.save;
        }
        mappedAbilities[key] = entry;
      }
    }
  }

  const actor: FoundryActor = {
    _id: a._id,
    name: a.name,
    type: a.type,
  };

  if (a.img) {
    actor.img = a.img;
  }

  if (hp) {
    const hpObj: { value?: number; max?: number; temp?: number } = {};
    if (typeof hp.value === 'number') {
      hpObj.value = hp.value;
    }
    if (typeof hp.max === 'number') {
      hpObj.max = hp.max;
    }
    if (typeof hp.temp === 'number') {
      hpObj.temp = hp.temp;
    }
    actor.hp = hpObj;
  }

  const derivedUnavailable: DerivedActorField[] = [];

  if (hp && typeof hp.max !== 'number') {
    derivedUnavailable.push('hpMax');
  }

  if (ac) {
    const acValue = typeof ac.value === 'number' ? ac.value : flatArmorClass(ac);
    if (acValue === undefined) {
      derivedUnavailable.push('ac');
    } else {
      actor.ac = { value: acValue };
    }
  }

  if (typeof details.level === 'number') {
    actor.level = details.level;
  } else if (a.type === 'character') {
    // dnd5e source data has no `details.level`; it is the class-item sum (#308).
    const level = characterClassLevel(a.items);
    if (level !== undefined) {
      actor.level = level;
      const attributes = isRecord(sys.attributes) ? sys.attributes : {};
      const prof = typeof attributes.prof === 'number' ? attributes.prof : proficiencyBonus(level);
      actor.attributes = { prof };
    }
  }

  if (derivedUnavailable.length > 0) {
    actor.derivedUnavailable = derivedUnavailable;
  }

  if (mappedAbilities) {
    actor.abilities = mappedAbilities;
  }

  const bio = extractString(details, 'biography', 'value') || extractString(details, 'biography');
  if (bio) {
    actor.biography = bio;
  }

  return actor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function extractNested(object: Record<string, unknown>, ...keys: string[]): unknown {
  let value: unknown = object;
  for (const key of keys) {
    if (!isRecord(value) || !Object.hasOwn(value, key)) {
      return undefined;
    }
    value = value[key];
  }
  return value;
}
function extractString(object: Record<string, unknown>, ...keys: string[]): string | null {
  const value = extractNested(object, ...keys);
  return typeof value === 'string' ? value : null;
}
