/**
 * Integration tests for world data loading and querying.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FoundryClient } from '../../src/foundry/client.js';
import { createConnectedClient } from './setup.js';

describe('World data', () => {
  let client: FoundryClient;

  beforeAll(async () => {
    client = await createConnectedClient();
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('worldData snapshot contains expected collections', () => {
    const data = client.getWorldData();
    expect(data).not.toBeNull();
    expect(data!.actors).toBeInstanceOf(Array);
    expect(data!.items).toBeInstanceOf(Array);
    expect(data!.scenes).toBeInstanceOf(Array);
    expect(data!.users).toBeInstanceOf(Array);
    expect(data!.journal).toBeInstanceOf(Array);
    expect(data!.combats).toBeInstanceOf(Array);
    expect(data!.messages).toBeInstanceOf(Array);
    expect(data!.macros).toBeInstanceOf(Array);
    expect(data!.playlists).toBeInstanceOf(Array);
    expect(data!.tables).toBeInstanceOf(Array);
    expect(data!.folders).toBeInstanceOf(Array);
  });

  it('getWorldSummary returns numeric counts', () => {
    const summary = client.getWorldSummary();
    expect(Object.keys(summary).length).toBeGreaterThan(0);

    for (const [key, value] of Object.entries(summary)) {
      expect(typeof value).toBe('number');
      expect(value).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('searchActors returns structured results', async () => {
    const result = await client.searchActors({});
    expect(result).toHaveProperty('actors');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('page');
    expect(result).toHaveProperty('limit');
    expect(result.actors).toBeInstanceOf(Array);
  });

  it('searchItems returns structured results', async () => {
    const result = await client.searchItems({});
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('page');
    expect(result).toHaveProperty('limit');
    expect(result.items).toBeInstanceOf(Array);
  });

  it('getScenes returns array', () => {
    const scenes = client.getScenes();
    expect(scenes).toBeInstanceOf(Array);
  });

  it('getJournals returns array', () => {
    const journals = client.getJournals();
    expect(journals).toBeInstanceOf(Array);
  });

  it('getUsers returns users and activeUsers', () => {
    const { users, activeUsers } = client.getUsers();
    expect(users).toBeInstanceOf(Array);
    expect(users.length).toBeGreaterThan(0);
    expect(activeUsers).toBeInstanceOf(Array);
  });

  it('searchWorld returns cross-collection results', () => {
    const result = client.searchWorld('');
    expect(result).toHaveProperty('actors');
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('scenes');
    expect(result).toHaveProperty('journals');
  });

  it('refreshWorldData updates cache', async () => {
    const beforeSummary = client.getWorldSummary();
    await client.refreshWorldData();
    const afterSummary = client.getWorldSummary();

    // Structure should be the same after refresh
    expect(Object.keys(afterSummary)).toEqual(Object.keys(beforeSummary));
  });
});
