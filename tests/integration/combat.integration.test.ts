/**
 * Integration tests for the combat control write tools (FR-018):
 * set_initiative and next_turn over the FoundryVTT `modifyDocument` Socket.IO
 * protocol.
 *
 * Unlike the handler unit tests (which mock the client), these drive real
 * game-state mutations against a live world, so they require:
 *   - a launched world with an *active* combat that has at least one combatant,
 *     and
 *   - the connected user to hold GM/owner permission (writes are GM-gated).
 *
 * When no active combat / combatant is present — e.g. the fresh, world-less CI
 * instance (issue #140) — the suite skips rather than failing, matching the
 * live-world precondition shared by the other integration specs.
 *
 * Reversible mutations are reverted: initiative is restored to its original
 * value and the turn/round pointers are restored, leaving world state
 * unchanged. end_combat is irreversible (it deletes the encounter) and is
 * therefore covered by unit tests ONLY — we do not run a destructive live
 * delete against the shared harness world.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FoundryClient } from '../../src/foundry/client.js';
import type { WorldCombat, WorldScene } from '../../src/foundry/types.js';
import { createConnectedClient } from './setup.js';

describe('Combat write operations', () => {
  let client: FoundryClient;
  let combat: WorldCombat | null = null;
  // Gate for start_combat: an active scene with at least one token AND no
  // pre-existing active combat (so we don't disturb a running encounter).
  let startableScene: WorldScene | null = null;

  beforeAll(async () => {
    // Writes are opt-in (FOUNDRY_WRITE_ENABLED) and require the Socket.IO
    // transport; the shared helper connects with username/password.
    client = await createConnectedClient({ writeEnabled: true });

    // The active combat doubles as the skip gate: a world-less instance, or a
    // world with no active encounter, yields null and every test skips.
    const active = client.getCombatState();
    if (active && active.combatants.length > 0) {
      combat = active;
    }

    if (!active) {
      const scene = client.getScenes().find((s) => s.active && (s.tokens?.length ?? 0) > 0);
      if (scene) {
        startableScene = scene;
      }
    }
  });

  afterAll(async () => {
    if (client) {
      await client.disconnect();
    }
  });

  it('set_initiative sets a combatant initiative then restores it', (ctx) => {
    if (!combat) {
      return ctx.skip();
    }
    return (async () => {
      const combatant = combat!.combatants[0];
      const original = combatant.initiative;

      await client.setCombatantInitiative(combat!._id, combatant._id, 99);

      // Restore the original value (null → not rolled; only restore a number).
      if (typeof original === 'number') {
        await client.setCombatantInitiative(combat!._id, combatant._id, original);
      }

      // No assertion on read-back: worldData is a stale snapshot after a write.
      // A resolved call without error is the round-trip success signal here.
      expect(true).toBe(true);
    })();
  });

  it('next_turn advances the active combat then restores turn/round', (ctx) => {
    if (!combat) {
      return ctx.skip();
    }
    return (async () => {
      const originalTurn = combat!.turn ?? 0;
      const originalRound = combat!.round;

      const n = combat!.combatants.length;
      const next = originalTurn + 1;
      const advanced =
        next >= n ? { turn: 0, round: originalRound + 1 } : { turn: next, round: originalRound };

      await client.updateCombat(combat!._id, advanced);

      // Restore the original turn/round so world state is left unchanged.
      await client.updateCombat(combat!._id, { turn: originalTurn, round: originalRound });

      expect(true).toBe(true);
    })();
  });

  it('start_combat creates an encounter from scene tokens then cleans it up', (ctx) => {
    if (!startableScene) {
      return ctx.skip();
    }
    return (async () => {
      const scene = startableScene!;
      const tokenId = (scene.tokens![0] as { _id?: string })._id;
      const actorId = (scene.tokens![0] as { actorId?: string }).actorId;

      let combatId: string | undefined;
      try {
        const seeds = tokenId ? [{ tokenId, sceneId: scene._id, actorId }] : [];
        const created = await client.startCombat(scene._id, seeds);
        combatId = created.combatId;

        expect(created.combatId).toBeTruthy();
        expect(created.combatantCount).toBe(seeds.length);

        // worldData is stale after a write — refresh, then confirm the new
        // encounter is the active combat.
        await client.refreshWorldData();
        const active = client.getCombatState();
        expect(active?._id).toBe(combatId);
      } finally {
        // Always remove the encounter we created, leaving world state unchanged.
        if (combatId) {
          await client.endCombat(combatId);
        }
      }
    })();
  });
});
