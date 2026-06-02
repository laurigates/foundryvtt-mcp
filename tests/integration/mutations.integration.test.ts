/**
 * Integration tests for the actor write tools (#142–144): item CRUD and
 * attribute mutation over the FoundryVTT `modifyDocument` Socket.IO protocol.
 *
 * Unlike the handler unit tests (which mock the client), these drive real
 * game-state mutations against a live world, so they require:
 *   - a launched world with at least one actor exposing a numeric
 *     `system.currency.gp` (dnd5e), and
 *   - the connected user to hold GM/owner permission (writes are GM-gated).
 *
 * When no mutable actor is present — e.g. the fresh, world-less CI instance
 * (issue #140) or a non-dnd5e system — the suite skips rather than failing,
 * matching the live-world precondition shared by the other integration specs.
 *
 * Every mutation is reverted: the created item is deleted and the poked
 * attribute is restored to its original value, leaving world state unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FoundryClient } from '../../src/foundry/client.js';
import { createConnectedClient } from './setup.js';

interface MutableTarget {
  id: string;
  name: string;
  gp: number;
}

describe('Actor write operations', () => {
  let client: FoundryClient;
  let target: MutableTarget | null = null;
  let createdItemId: string | undefined;

  beforeAll(async () => {
    // Writes are opt-in (FOUNDRY_WRITE_ENABLED) and require the Socket.IO
    // transport; the shared helper connects with username/password.
    client = await createConnectedClient({ writeEnabled: true });

    // Find an actor with a numeric system.currency.gp to safely poke. This
    // doubles as the skip gate: a world-less instance yields no candidates.
    const { actors } = await client.searchActors({ limit: 500 });
    for (const actor of actors) {
      const raw = client.getRawActor(actor._id) as
        | { system?: { currency?: { gp?: unknown } } }
        | undefined;
      const gp = raw?.system?.currency?.gp;
      if (typeof gp === 'number') {
        target = { id: actor._id, name: actor.name, gp };
        break;
      }
    }
  });

  afterAll(async () => {
    // Best-effort cleanup if a test left the item behind (e.g. delete failed).
    if (client && target && createdItemId) {
      await client.deleteActorItem(target.id, createdItemId).catch(() => {});
    }
    if (client) {
      await client.disconnect();
    }
  });

  it('create_actor_item adds an inline item to an actor', (ctx) => {
    if (!target) {
      return ctx.skip();
    }
    return (async () => {
      const created = await client.createActorItem(target!.id, {
        type: 'inline',
        item: {
          name: 'MCP integration test item',
          type: 'loot',
          system: { quantity: 1 },
        } as never,
      });
      createdItemId = (created as { _id?: string })._id;
      expect(createdItemId).toBeTruthy();
      expect(created).toMatchObject({ name: 'MCP integration test item' });
    })();
  });

  it('update_actor_item patches the item system data', (ctx) => {
    if (!target || !createdItemId) {
      return ctx.skip();
    }
    return (async () => {
      const updated = await client.updateActorItem(target!.id, createdItemId!, { quantity: 3 });
      expect(updated).toBeTruthy();
      // The server echoes the updated document; when present, quantity reflects the patch.
      const quantity = (updated as { system?: { quantity?: number } })?.system?.quantity;
      if (quantity !== undefined) {
        expect(quantity).toBe(3);
      }
    })();
  });

  it('update_actor_attributes mutates then restores currency.gp', (ctx) => {
    if (!target) {
      return ctx.skip();
    }
    return (async () => {
      const set = await client.updateActorAttribute(target!.id, { 'currency.gp': target!.gp + 1 });
      expect(set.success).toBe(true);
      expect(set.updatedAttributes).toHaveProperty('currency.gp');

      // Restore the original value so world state is left unchanged.
      const restored = await client.updateActorAttribute(target!.id, {
        'currency.gp': target!.gp,
      });
      expect(restored.success).toBe(true);
    })();
  });

  it('delete_actor_item removes the created item', (ctx) => {
    if (!target || !createdItemId) {
      return ctx.skip();
    }
    return (async () => {
      await expect(client.deleteActorItem(target!.id, createdItemId!)).resolves.toBeUndefined();
      createdItemId = undefined;
    })();
  });
});
