/**
 * @fileoverview dnd5e values that are exact from source data (#308).
 *
 * The Socket.IO `world` payload carries actor *source* data. dnd5e computes
 * its derived values (ability `mod`, `details.level`, `attributes.prof`,
 * `attributes.ac.value`, …) client-side in `prepareData`, so they are absent
 * here. The helpers below cover only the values whose rules need nothing but
 * source data; AC (other than a flat calculation), save and skill totals, and
 * anything an Active Effect changes are deliberately not reimplemented.
 */

import type { WorldItem } from './types.js';

/** dnd5e ability modifier: `floor((score - 10) / 2)`. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Character level as dnd5e derives it: the sum of `system.levels` over the
 * actor's embedded `class` items. Returns undefined when no class item carries
 * a numeric level.
 */
export function characterClassLevel(items: WorldItem[] | undefined): number | undefined {
  const levels = (items ?? [])
    .filter((item) => item.type === 'class')
    .map((item) => item.system?.levels)
    .filter((levels): levels is number => typeof levels === 'number');
  return levels.length > 0 ? levels.reduce((sum, n) => sum + n, 0) : undefined;
}

/** dnd5e proficiency bonus for a character level: `floor((level - 1) / 4) + 2`. */
export function proficiencyBonus(level: number): number {
  return Math.floor((level - 1) / 4) + 2;
}

/**
 * The armor class when dnd5e's calculation is `flat`, which it uses as-is.
 * Every other calculation depends on equipped armor, shields, abilities and
 * effects, so it returns undefined; a stored `flat` under another calculation
 * is a leftover and not the actor's AC.
 */
export function flatArmorClass(ac: Record<string, unknown>): number | undefined {
  return ac.calc === 'flat' && typeof ac.flat === 'number' ? ac.flat : undefined;
}
