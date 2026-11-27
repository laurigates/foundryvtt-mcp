/**
 * @fileoverview Unit tests for the dnd5e values that are exact from source
 * data (#308): ability modifiers, class level, proficiency bonus and flat AC.
 */

import { describe, expect, it } from 'vitest';
import {
  abilityModifier,
  characterClassLevel,
  flatArmorClass,
  proficiencyBonus,
} from '../dnd5e-derived.js';
import type { WorldItem } from '../types.js';

function item(type: string, system: Record<string, unknown>, name = type): WorldItem {
  return { _id: `${name}-id`, name, type, system };
}

describe('abilityModifier', () => {
  it.each([
    [30, 10],
    [18, 4],
    [14, 2],
    [11, 0],
    [10, 0],
    [9, -1],
    [8, -1],
    [3, -4],
    [1, -5],
  ])('score %i gives modifier %i', (score, mod) => {
    expect(abilityModifier(score)).toBe(mod);
  });
});

describe('characterClassLevel', () => {
  it('sums system.levels across multiclass class items', () => {
    const items = [
      item('class', { levels: 7 }, 'Paladin'),
      item('class', { levels: 3 }, 'Warlock'),
      item('weapon', { levels: 99 }, 'Longsword'),
      item('subclass', { levels: 5 }, 'Oath of Devotion'),
    ];
    expect(characterClassLevel(items)).toBe(10);
  });

  it('returns undefined when there are no class items', () => {
    expect(characterClassLevel([item('weapon', {})])).toBeUndefined();
    expect(characterClassLevel([])).toBeUndefined();
    expect(characterClassLevel(undefined)).toBeUndefined();
  });

  it('ignores class items whose levels is not a number', () => {
    expect(characterClassLevel([item('class', { levels: null })])).toBeUndefined();
    expect(
      characterClassLevel([item('class', { levels: '4' }), item('class', { levels: 2 })]),
    ).toBe(2);
  });
});

describe('proficiencyBonus', () => {
  it.each([
    [1, 2],
    [4, 2],
    [5, 3],
    [8, 3],
    [9, 4],
    [10, 4],
    [13, 5],
    [17, 6],
    [20, 6],
  ])('level %i gives +%i', (level, bonus) => {
    expect(proficiencyBonus(level)).toBe(bonus);
  });
});

describe('flatArmorClass', () => {
  it('returns ac.flat when the calculation is flat', () => {
    expect(flatArmorClass({ calc: 'flat', flat: 17 })).toBe(17);
  });

  it('returns undefined for any other calculation, even with a stored flat value', () => {
    expect(flatArmorClass({ calc: 'default', flat: 16, formula: '' })).toBeUndefined();
    expect(flatArmorClass({ calc: 'natural', flat: 13 })).toBeUndefined();
  });

  it('returns undefined for a flat calculation without a numeric flat value', () => {
    expect(flatArmorClass({ calc: 'flat', flat: null })).toBeUndefined();
  });
});
