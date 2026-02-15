/**
 * Integration tests for connection lifecycle.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { FoundryClient } from '../../src/foundry/client.js';
import { createTestClient, createConnectedClient } from './setup.js';

describe('Connection lifecycle', () => {
  let client: FoundryClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.disconnect();
      client = null;
    }
  });

  it('reports connected state after connect', async () => {
    client = await createConnectedClient();

    expect(client.isConnected()).toBe(true);
    expect(client.hasWorldData()).toBe(true);
  });

  it('reports disconnected state after disconnect', async () => {
    client = await createConnectedClient();
    await client.disconnect();

    expect(client.isConnected()).toBe(false);
    expect(client.hasWorldData()).toBe(false);
    expect(client.getWorldData()).toBeNull();

    client = null; // Already disconnected
  });

  it('reconnects after disconnect', async () => {
    client = await createConnectedClient();
    await client.disconnect();

    expect(client.isConnected()).toBe(false);

    // Create a fresh client (socket state is not reusable after disconnect)
    client = await createConnectedClient();

    expect(client.isConnected()).toBe(true);
    expect(client.hasWorldData()).toBe(true);
  });

  it('fails to connect to wrong port', async () => {
    client = createTestClient({ baseUrl: 'http://localhost:19999', timeout: 5000 });

    await expect(client.connect()).rejects.toThrow();
    expect(client.isConnected()).toBe(false);
  });
});
