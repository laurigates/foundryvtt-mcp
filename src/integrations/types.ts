export type IntegrationKind = 'system' | 'module';

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
