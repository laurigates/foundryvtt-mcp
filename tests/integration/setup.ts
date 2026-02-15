/**
 * Shared setup utilities for integration tests.
 */

import { FoundryClient, FoundryClientConfig } from '../../src/foundry/client.js';

const DEFAULT_CONFIG: FoundryClientConfig = {
  baseUrl: process.env.FOUNDRY_URL || 'http://localhost:30001',
  username: process.env.FOUNDRY_USERNAME || 'test-user',
  password: process.env.FOUNDRY_PASSWORD || 'test-password',
  timeout: 15000,
};

/**
 * Creates a configured FoundryClient for integration tests.
 */
export function createTestClient(overrides?: Partial<FoundryClientConfig>): FoundryClient {
  return new FoundryClient({ ...DEFAULT_CONFIG, ...overrides });
}

/**
 * Creates a client, connects it, and returns it.
 * Caller is responsible for disconnecting.
 */
export async function createConnectedClient(
  overrides?: Partial<FoundryClientConfig>,
): Promise<FoundryClient> {
  const client = createTestClient(overrides);
  await client.connect();
  return client;
}
