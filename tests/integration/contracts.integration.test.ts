/**
 * Integration tests for data contract / schema validation.
 * Ensures real FoundryVTT data matches our TypeScript interfaces.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FoundryClient } from '../../src/foundry/client.js';
import { WorldData } from '../../src/foundry/types.js';
import { createConnectedClient } from './setup.js';

describe('Data contracts', () => {
  let client: FoundryClient;
  let worldData: WorldData;

  beforeAll(async () => {
    client = await createConnectedClient();
    const data = client.getWorldData();
    expect(data).not.toBeNull();
    worldData = data!;
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('worldData has required top-level fields', () => {
    expect(worldData).toHaveProperty('userId');
    expect(typeof worldData.userId).toBe('string');
    expect(worldData).toHaveProperty('release');
    expect(worldData).toHaveProperty('world');
    expect(worldData).toHaveProperty('system');
    expect(worldData).toHaveProperty('actors');
    expect(worldData).toHaveProperty('items');
    expect(worldData).toHaveProperty('scenes');
    expect(worldData).toHaveProperty('users');
  });

  it('actor documents have required fields', () => {
    for (const actor of worldData.actors) {
      expect(actor._id).toBeTypeOf('string');
      expect(actor._id.length).toBeGreaterThan(0);
      expect(actor.name).toBeTypeOf('string');
      expect(actor.type).toBeTypeOf('string');
    }
  });

  it('item documents have required fields', () => {
    for (const item of worldData.items) {
      expect(item._id).toBeTypeOf('string');
      expect(item._id.length).toBeGreaterThan(0);
      expect(item.name).toBeTypeOf('string');
      expect(item.type).toBeTypeOf('string');
    }
  });

  it('scene documents have required fields', () => {
    for (const scene of worldData.scenes) {
      expect(scene._id).toBeTypeOf('string');
      expect(scene._id.length).toBeGreaterThan(0);
      expect(scene.name).toBeTypeOf('string');
      expect(typeof scene.active).toBe('boolean');
      expect(typeof scene.width).toBe('number');
      expect(typeof scene.height).toBe('number');
    }
  });

  it('user documents have required fields', () => {
    for (const user of worldData.users) {
      expect(user._id).toBeTypeOf('string');
      expect(user.name).toBeTypeOf('string');
      expect(typeof user.role).toBe('number');
    }
  });

  it('optional fields do not cause crashes when missing', () => {
    // Accessing optional fields on all entities should not throw
    for (const actor of worldData.actors) {
      // These may be undefined — just ensure no crash
      void actor.img;
      void actor.folder;
      void actor.effects;
      void actor.items;
      void actor.ownership;
      void actor.flags;
    }

    for (const item of worldData.items) {
      void item.img;
      void item.folder;
      void item.effects;
      void item.ownership;
      void item.flags;
    }
  });
});
