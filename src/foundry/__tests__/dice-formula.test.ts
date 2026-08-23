/**
 * @fileoverview Unit tests for the dice formula parser/evaluator (#219).
 *
 * The old `fallbackDiceRoll` regex only captured a modifier glued directly to a
 * dice term, so anything else the character-class validator let through was
 * silently dropped from the total. These tests pin the two properties that
 * replaced it: correct evaluation of the formulas we support, and a loud,
 * specific error for everything else.
 */

import { describe, expect, it } from 'vitest';
import { evaluateDiceFormula, parseDiceFormula } from '../dice-formula.js';

/** Deterministic RNG: replays a fixed sequence, then repeats the last value. */
function seededRng(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

describe('parseDiceFormula', () => {
  it('parses a bare dice term', () => {
    expect(parseDiceFormula('3d6')).toEqual([{ kind: 'dice', sign: 1, count: 3, sides: 6 }]);
  });

  it('defaults a count-less term to a single die', () => {
    expect(parseDiceFormula('d20')).toEqual([{ kind: 'dice', sign: 1, count: 1, sides: 20 }]);
  });

  it('parses dice and constants in any mix', () => {
    expect(parseDiceFormula('2d6 + 1d4 - 3')).toEqual([
      { kind: 'dice', sign: 1, count: 2, sides: 6 },
      { kind: 'dice', sign: 1, count: 1, sides: 4 },
      { kind: 'constant', sign: -1, value: 3 },
    ]);
  });

  it('accepts a leading sign', () => {
    expect(parseDiceFormula('-1d4+2')).toEqual([
      { kind: 'dice', sign: -1, count: 1, sides: 4 },
      { kind: 'constant', sign: 1, value: 2 },
    ]);
  });
});

/**
 * The exact table from issue #219: every one of these used to return a
 * plausible-but-wrong number.
 */
describe.each([
  {
    formula: '1d20+5',
    rng: [0.5],
    total: 16,
    breakdown: '1d20: [11] + 5 = 16',
  },
  {
    formula: '1d20 + 5',
    rng: [0.5],
    total: 16,
    breakdown: '1d20: [11] + 5 = 16',
  },
  {
    formula: '1d20+5+3',
    rng: [0.5],
    total: 19,
    breakdown: '1d20: [11] + 5 + 3 = 19',
  },
  {
    formula: 'd20',
    rng: [0.5],
    total: 11,
    breakdown: '1d20: [11] = 11',
  },
  {
    formula: '2d6+1d4',
    rng: [0, 0.99, 0.5],
    total: 10,
    breakdown: '2d6: [1, 6] + 1d4: [3] = 10',
  },
  {
    formula: '1d20 - 2',
    rng: [0.95],
    total: 18,
    breakdown: '1d20: [20] - 2 = 18',
  },
  {
    formula: '10 - 4',
    rng: [],
    total: 6,
    breakdown: '10 - 4 = 6',
  },
  {
    formula: '0d6+2',
    rng: [],
    total: 2,
    breakdown: '0d6: [] + 2 = 2',
  },
])('evaluateDiceFormula($formula)', ({ formula, rng, total, breakdown }) => {
  it(`totals ${total}`, () => {
    expect(evaluateDiceFormula(formula, seededRng(rng)).total).toBe(total);
  });

  it('renders a breakdown matching the total', () => {
    const result = evaluateDiceFormula(formula, seededRng(rng));
    expect(result.breakdown).toBe(breakdown);
  });

  it('reports per-term rolls that sum to the total', () => {
    const result = evaluateDiceFormula(formula, seededRng(rng));
    const summed = result.terms.reduce((sum, term) => sum + term.sign * term.value, 0);
    expect(summed).toBe(result.total);

    for (const term of result.terms) {
      if (term.kind !== 'dice') {
        continue;
      }
      expect(term.rolls).toHaveLength(term.count);
      expect(term.rolls.reduce((sum, roll) => sum + roll, 0)).toBe(term.value);
      for (const roll of term.rolls) {
        expect(roll).toBeGreaterThanOrEqual(1);
        expect(roll).toBeLessThanOrEqual(term.sides);
      }
    }
  });
});

describe.each([
  { formula: '(1d20+5)', reason: 'parentheses', match: /parenthes/i },
  { formula: '(1d20+5)*2', reason: 'parentheses', match: /parenthes/i },
  { formula: '1d20+', reason: 'a dangling operator', match: /ends with/i },
  { formula: '+', reason: 'a lone operator', match: /ends with/i },
  { formula: '1d20 5', reason: 'a missing operator', match: /unexpected/i },
  { formula: 'd', reason: 'a die with no sides', match: /unexpected/i },
  { formula: '1d0', reason: 'a zero-sided die', match: /at least 1 side/i },
  { formula: '', reason: 'an empty formula', match: /empty/i },
  { formula: '   ', reason: 'a whitespace-only formula', match: /empty/i },
  { formula: '4d6kh3', reason: 'unsupported Foundry syntax', match: /unexpected/i },
  { formula: '2000d6', reason: 'an absurd dice count', match: /too many dice/i },
])('rejects $reason', ({ formula, match }) => {
  it(`throws for "${formula}" rather than dropping part of it`, () => {
    expect(() => parseDiceFormula(formula)).toThrow(match);
    expect(() => evaluateDiceFormula(formula)).toThrow(match);
  });

  it(`names the offending formula for "${formula}"`, () => {
    expect(() => parseDiceFormula(formula)).toThrow(/dice formula/i);
  });
});
