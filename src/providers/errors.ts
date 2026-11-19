export type ProviderErrorCode =
  | 'unsupported_operation'
  | 'target_offline'
  | 'writes_disabled'
  | 'identity_mismatch'
  | 'invalid_response'
  | 'execution_rejected'
  | 'outcome_unknown'
  | 'session_changed';

/** A transport failure after dispatch is distinct from a confirmed rejection. */
export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProviderError';
  }
}
