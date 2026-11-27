import Ajv from 'ajv';

/**
 * Strict Ajv policy shared by the runtime validator and the contract tests.
 * A single factory keeps the two from drifting, so a schema the tests accept
 * cannot be rejected at execution time, or the reverse.
 */
export function createContractAjv(): Ajv {
  return new Ajv({ allErrors: true, strict: true });
}
