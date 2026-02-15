/**
 * Integration tests for FoundryVTT authentication flow.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { FoundryClient } from '../../src/foundry/client.js';
import { createTestClient } from './setup.js';

describe('Authentication', () => {
  let client: FoundryClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.disconnect();
      client = null;
    }
  });

  it('connects with valid credentials and receives worldData', async () => {
    client = createTestClient();
    await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(client.hasWorldData()).toBe(true);
  });

  it('rejects invalid password', async () => {
    client = createTestClient({ password: 'wrong-password' });

    await expect(client.connect()).rejects.toThrow();
    expect(client.isConnected()).toBe(false);
  });

  it('rejects invalid username', async () => {
    client = createTestClient({ username: 'nonexistent-user' });

    await expect(client.connect()).rejects.toThrow();
    expect(client.isConnected()).toBe(false);
  });

  it('connects with direct userId bypass', async () => {
    // First connect to discover the userId
    const discoveryClient = createTestClient();
    await discoveryClient.connect();
    const users = discoveryClient.getUsers();
    await discoveryClient.disconnect();

    const testUser = users.users.find(
      (u) => u.name === (process.env.FOUNDRY_USERNAME || 'test-user'),
    );
    expect(testUser).toBeDefined();

    // Connect using direct userId
    client = createTestClient({
      username: undefined,
      userId: testUser!._id,
    });
    await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(client.hasWorldData()).toBe(true);
  });
});
