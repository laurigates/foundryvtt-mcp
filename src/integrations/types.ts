export type IntegrationKind = 'system' | 'module';

/** Read a Foundry release generation without guessing from a malformed version. */
export function parseFoundryGeneration(version: string): number | undefined {
  const match = /^([1-9]\d*)(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/.exec(version.trim());
  if (!match) {
    return undefined;
  }
  const generation = Number(match[1]);
  return Number.isSafeInteger(generation) ? generation : undefined;
}

export interface IntegrationEnvironment {
  foundryVersion: string;
  system: { id: string; version: string };
  modules: Array<{ id: string; version: string; active: boolean }>;
  ready?: boolean;
  runtimeAvailable?: boolean;
}

export interface IntegrationTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  readOnly: boolean;
}

export type IntegrationState =
  | 'ready'
  | 'absent'
  | 'inactive'
  | 'incompatible'
  | 'unsupported'
  | 'not-ready'
  | 'error';

export interface IntegrationStatus {
  kind: IntegrationKind;
  id: string;
  adapterVersion: string;
  installedVersion?: string;
  /** Selected versioned package; absent for a flat package or no selection. */
  foundryGeneration?: number;
  /** Generations with locally valid packages, not a live compatibility claim. */
  availableGenerations?: number[];
  /** Other broken variants remain diagnosable without disabling a healthy selection. */
  variantErrors?: Array<{ foundryGeneration?: number; reason: string }>;
  state: IntegrationState;
  reason?: string;
  operations: Array<{ name: string; available: boolean; reason?: string }>;
}

export class IntegrationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IntegrationError';
  }
}
