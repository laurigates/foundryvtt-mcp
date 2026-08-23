/**
 * @fileoverview Dice formula parsing and evaluation for the local roller (#219).
 *
 * The local roller used to scan a formula with `/(\d+)d(\d+)([+-]\d+)?/g`, which
 * only captures a modifier glued directly to a dice term. Everything else the
 * caller's character-class validator let through — a space-separated modifier
 * (`1d20 + 5`), a second bonus (`1d20+5+3`), a count-less die (`d20`), a second
 * dice term (`2d6+1d4`), parentheses — was silently dropped from the total. A
 * dropped term produces a plausible number that is simply wrong, which for a
 * dice roller is worse than an error: nothing signals that the formula was not
 * understood.
 *
 * So this module does two things, in this order of importance:
 *  1. Parses the whole formula into dice terms and standalone constants.
 *  2. Consumes the input end to end, and throws a specific error on anything it
 *     cannot represent. Nothing is ever dropped in silence.
 *
 * The supported grammar is deliberately small:
 *
 *     formula  := sign? term ( sign term )*
 *     term     := dice | constant
 *     dice     := digit* 'd' digit+          // a missing count means 1
 *     constant := digit+
 *     sign     := '+' | '-'
 *
 * Parentheses, multiplication and Foundry's modifier syntax (`4d6kh3`, `1d20r1`)
 * are NOT supported and are rejected by name rather than ignored.
 */

/** A dice term such as `2d6`, carried with the sign that precedes it. */
export interface DiceFormulaDiceTerm {
  kind: 'dice';
  sign: 1 | -1;
  count: number;
  sides: number;
}

/** A standalone whole-number constant such as the `5` in `1d20 + 5`. */
export interface DiceFormulaConstantTerm {
  kind: 'constant';
  sign: 1 | -1;
  value: number;
}

export type DiceFormulaTerm = DiceFormulaDiceTerm | DiceFormulaConstantTerm;

/** A term after evaluation: the same shape plus the rolls and the subtotal. */
export type RolledTerm =
  | (DiceFormulaDiceTerm & { rolls: number[]; value: number })
  | (DiceFormulaConstantTerm & { rolls?: undefined });

export interface DiceFormulaResult {
  /** Signed sum of every term — never a partial total. */
  total: number;
  /** Human-readable rendering, e.g. `2d6: [3, 5] + 1d4: [2] = 10`. */
  breakdown: string;
  terms: RolledTerm[];
}

/**
 * Upper bound on dice per term. A formula is capped at 100 characters upstream,
 * which still allows five-digit counts; rolling those is pointless and slow, so
 * it is refused explicitly rather than attempted.
 */
export const MAX_DICE_PER_TERM = 1000;

/** Matches one term at a fixed offset: `NdS`, `dS`, or a bare constant. */
const TERM_PATTERN = /(\d*)d(\d+)|(\d+)/y;

function invalid(formula: string, detail: string): Error {
  return new Error(`Invalid dice formula "${formula}": ${detail}`);
}

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

/**
 * Parses a dice formula into its terms.
 *
 * @throws {Error} if the formula is empty, or holds anything the grammar above
 *   cannot represent. The message names the offending formula and what was
 *   wrong with it.
 */
export function parseDiceFormula(formula: string): DiceFormulaTerm[] {
  if (typeof formula !== 'string' || formula.trim() === '') {
    throw new Error('Invalid dice formula: the formula is empty.');
  }

  if (formula.includes('(') || formula.includes(')')) {
    throw new Error(
      `Unsupported dice formula "${formula}": parentheses are not supported. ` +
        'Expand the expression into plain terms joined by + or - (e.g. "1d20+5").',
    );
  }

  const terms: DiceFormulaTerm[] = [];
  let index = 0;
  let sign: 1 | -1 = 1;

  const skipWhitespace = () => {
    while (isWhitespace(formula[index])) {
      index += 1;
    }
  };

  skipWhitespace();
  if (formula[index] === '+' || formula[index] === '-') {
    sign = formula[index] === '-' ? -1 : 1;
    index += 1;
    skipWhitespace();
  }

  for (;;) {
    if (index >= formula.length) {
      throw invalid(formula, 'it ends with a dangling operator.');
    }

    TERM_PATTERN.lastIndex = index;
    const match = TERM_PATTERN.exec(formula);
    if (!match) {
      throw invalid(
        formula,
        `unexpected "${formula[index]}" at position ${index}. Supported syntax: dice terms ` +
          '(NdS, or dS for a single die) and whole numbers, joined by + or -.',
      );
    }
    index = TERM_PATTERN.lastIndex;

    const [, rawCount, rawSides, rawConstant] = match;
    if (rawSides !== undefined) {
      // A missing count means one die: "d20" is "1d20".
      const count = rawCount === '' || rawCount === undefined ? 1 : Number.parseInt(rawCount, 10);
      const sides = Number.parseInt(rawSides, 10);
      if (sides < 1) {
        throw invalid(formula, 'a die must have at least 1 side.');
      }
      if (count > MAX_DICE_PER_TERM) {
        throw invalid(
          formula,
          `too many dice (${count}); the limit is ${MAX_DICE_PER_TERM} per term.`,
        );
      }
      terms.push({ kind: 'dice', sign, count, sides });
    } else {
      terms.push({ kind: 'constant', sign, value: Number.parseInt(rawConstant ?? '0', 10) });
    }

    skipWhitespace();
    if (index >= formula.length) {
      return terms;
    }

    const operator = formula[index];
    if (operator !== '+' && operator !== '-') {
      throw invalid(
        formula,
        `unexpected "${operator}" at position ${index}; terms must be joined by + or -.`,
      );
    }
    sign = operator === '-' ? -1 : 1;
    index += 1;
    skipWhitespace();
  }
}

/** Renders one evaluated term, e.g. `2d6: [3, 5]` or `5`. */
function renderTerm(term: RolledTerm): string {
  return term.kind === 'dice'
    ? `${term.count}d${term.sides}: [${term.rolls.join(', ')}]`
    : `${term.value}`;
}

/**
 * Rolls a formula and returns the total together with the terms that produced it.
 *
 * @param formula - Formula in the grammar documented above.
 * @param rng - Uniform [0, 1) source; injectable so tests can be deterministic.
 * @throws {Error} for any formula {@link parseDiceFormula} cannot represent.
 */
export function evaluateDiceFormula(
  formula: string,
  rng: () => number = Math.random,
): DiceFormulaResult {
  const parsed = parseDiceFormula(formula);
  const terms: RolledTerm[] = [];
  let total = 0;

  for (const term of parsed) {
    if (term.kind === 'constant') {
      total += term.sign * term.value;
      terms.push(term);
      continue;
    }

    const rolls: number[] = [];
    for (let i = 0; i < term.count; i += 1) {
      rolls.push(Math.floor(rng() * term.sides) + 1);
    }
    const value = rolls.reduce((sum, roll) => sum + roll, 0);
    total += term.sign * value;
    terms.push({ ...term, rolls, value });
  }

  const rendered = terms
    .map((term, position) => {
      const body = renderTerm(term);
      if (position === 0) {
        return term.sign === -1 ? `-${body}` : body;
      }
      return `${term.sign === -1 ? '-' : '+'} ${body}`;
    })
    .join(' ');

  return { total, breakdown: `${rendered} = ${total}`, terms };
}
