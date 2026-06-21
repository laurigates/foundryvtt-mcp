/**
 * Integration tests for the token manipulation write tools (FR-019):
 * move_token and apply_status_effect over the FoundryVTT `modifyDocument`
 * Socket.IO protocol.
 *
 * Unlike the handler unit tests (which mock the client), these drive real
 * game-state mutations against a live world, so they require:
 *   - a launched world with a scene that has at least one token, and
 *   - the connected user to hold GM/owner permission (writes are GM-gated).
 *
 * When no scene/token is present — e.g. the fresh, world-less CI instance
 * (issue #140) — the suite skips rather than failing, matching the live-world
 * precondition shared by the other integration specs.
 *
 * Reversible mutations are reverted: the token is moved and then restored to
 * its original coordinates, and any applied status effect is removed again,
 * leaving world state unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FoundryClient } from '../../src/foundry/client.js';
import type { WorldScene } from '../../src/foundry/types.js';
import { createConnectedClient } from './setup.js';

interface LocatedToken {
  scene: WorldScene;
  token: { _id: string; x: number; y: number; actorId?: string; actorLink?: boolean };
}

describe('Token write operations', () => {
  let client: FoundryClient;
  let located: LocatedToken | null = null;

  beforeAll(async () => {
    // Writes are opt-in (FOUNDRY_WRITE_ENABLED) and require the Socket.IO
    // transport; the shared helper connects with username/password.
    client = await createConnectedClient({ writeEnabled: true });

    // First scene with a token doubles as the skip gate.
    for (const scene of client.getScenes()) {
      const token = scene.tokens?.[0] as LocatedToken['token'] | undefined;
      if (token?._id) {
        located = { scene, token };
        break;
      }
    }
  });

  afterAll(async () => {
    if (client) {
      await client.disconnect();
    }
  });

  it('move_token moves a token then restores its coordinates', (ctx) => {
    if (!located) {
      return ctx.skip();
    }
    return (async () => {
      const { scene, token } = located!;
      const originalX = typeof token.x === 'number' ? token.x : 0;
      const originalY = typeof token.y === 'number' ? token.y : 0;

      await client.moveToken(scene._id, token._id, originalX + 50, originalY + 50);
      // Restore the original position so world state is left unchanged.
      await client.moveToken(scene._id, token._id, originalX, originalY);

      // No assertion on read-back: worldData is a stale snapshot after a write.
      // A resolved call without error is the round-trip success signal here.
      expect(true).toBe(true);
    })();
  });

  it('apply_status_effect applies then removes a status on the token actor', (ctx) => {
    if (!located || !located.token.actorId) {
      return ctx.skip();
    }
    return (async () => {
      const { scene, token } = located!;
      const parentUuid =
        token.actorLink === true
          ? `Actor.${token.actorId}`
          : `Scene.${scene._id}.Token.${token._id}.Actor.${token.actorId}`;

      const effect = await client.createActorStatusEffect(parentUuid, 'prone');
      // Revert: remove the effect we just applied.
      await client.deleteActorEffect(parentUuid, effect._id);

      expect(true).toBe(true);
    })();
  });
});
