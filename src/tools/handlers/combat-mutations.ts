/**
 * @fileoverview Combat control mutation tool handlers (FR-018)
 *
 * Provides GM-gated combat-control tools that operate on the *active* combat:
 * advancing the turn, ending the encounter, and setting a combatant's
 * initiative. All are WRITE operations — they require FOUNDRY_WRITE_ENABLED=true
 * and an active Socket.IO connection (mutations use the core `modifyDocument`
 * protocol), and the connected user needs GM/owner permission.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { FoundryClient } from '../../foundry/client.js';
import type { WorldCombat, WorldScene } from '../../foundry/types.js';
import {
  getCurrentCombatant,
  getTurnOrder,
  turnIndexAfterInitiativeChange,
} from './combat-order.js';
import { withToolError } from './utils.js';

/** A combatant seed derived from a scene token, sent to the create wire. */
interface CombatantSeed {
  tokenId: string;
  sceneId: string;
  actorId?: string | undefined;
}

/**
 * Computes the next `{ turn, round }` for an active combat.
 *
 * Advances to the next combatant in order; wrapping past the last combatant
 * rolls over to turn 0 of the next round.
 *
 * `Combat#turn` is an index into the **initiative-sorted** turn order (see
 * `combat-order.ts`), *not* into the stored/creation order of
 * `combat.combatants` — the same order `get_combat_state` renders (#214).
 *
 * When `skipDefeated` is true, `defeated` combatants are skipped — mirroring
 * Foundry's `Combat#nextTurn`/`nextRound` with the `skipDefeated` setting. If
 * every combatant is defeated, the round still advances (turn 0), matching
 * Foundry's "none remaining" fallback rather than hanging.
 *
 * @throws if the combat has no combatants (cannot advance an empty encounter).
 */
export function computeNextTurn(
  combat: WorldCombat,
  skipDefeated = false,
): { turn: number; round: number } {
  const combatants = getTurnOrder(combat);
  const n = combatants.length;
  if (n === 0) {
    throw new Error('Cannot advance turn: active combat has no combatants');
  }

  const cur = combat.turn ?? 0;

  // Scan forward within the current round for the next eligible combatant.
  for (let i = cur + 1; i < n; i++) {
    if (skipDefeated && combatants[i]?.defeated) {
      continue;
    }
    return { turn: i, round: combat.round };
  }

  // No eligible combatant left this round — advance to the next round.
  const round = combat.round + 1;
  if (!skipDefeated) {
    return { turn: 0, round };
  }
  const firstAlive = combatants.findIndex((c) => !c.defeated);
  return { turn: firstAlive === -1 ? 0 : firstAlive, round };
}

/**
 * Advances the active combat to the next turn (FR-018).
 *
 * Accepts an optional `skipDefeated` argument; when omitted it falls back to the
 * combat's `settings.skipDefeated` (if present in the worldData snapshot), then
 * to `false`.
 */
export async function handleNextTurn(
  args: { skipDefeated?: boolean },
  foundryClient: FoundryClient,
) {
  const combat = foundryClient.getCombatState();
  if (!combat) {
    throw new McpError(ErrorCode.InvalidRequest, 'No active combat to advance.');
  }

  const skipDefeated = args?.skipDefeated ?? combat.settings?.skipDefeated ?? false;

  return withToolError('advance combat turn', async () => {
    const { turn, round } = computeNextTurn(combat, skipDefeated);
    await foundryClient.updateCombat(combat._id, { turn, round });

    const current = getTurnOrder(combat)[turn];
    const currentName = current ? current.name : 'unknown';

    return {
      content: [
        {
          type: 'text',
          text: `⚔️ **Combat Turn Advanced**
**Round:** ${round}
**Turn:** ${turn + 1} of ${combat.combatants.length}
**Now acting:** ${currentName}`,
        },
      ],
    };
  });
}

/**
 * Ends (deletes) the active combat encounter (FR-018).
 */
export async function handleEndCombat(
  _args: Record<string, unknown>,
  foundryClient: FoundryClient,
) {
  const combat = foundryClient.getCombatState();
  if (!combat) {
    throw new McpError(ErrorCode.InvalidRequest, 'No active combat to end.');
  }

  return withToolError('end combat', async () => {
    await foundryClient.endCombat(combat._id);

    return {
      content: [
        {
          type: 'text',
          text: `⚔️ **Combat Ended**
**Encounter:** ${combat._id}
The active combat encounter has been removed.`,
        },
      ],
    };
  });
}

/**
 * Sets a combatant's initiative in the active combat (FR-018).
 *
 * `combatId` defaults to the active combat when omitted.
 *
 * Writing an initiative re-sorts the turn order underneath the stored
 * `Combat#turn`, which indexes that order (#214) — so a different combatant can
 * slide under the stored index. FoundryVTT's `Combat#setupTurns` re-finds the
 * combatant that was acting and re-points `turn` at its new index; this handler
 * mirrors that, so the MCP and Foundry never disagree about whose turn it is
 * after an initiative correction. The re-anchor is skipped when there is
 * nothing to anchor: no combatant is acting yet (round-0 setup, `turn` null, or
 * a stale index), the acting combatant's index is unchanged, or the write
 * targets a combat other than the active one (the only one readable here).
 */
export async function handleSetInitiative(
  args: { combatantId: string; initiative: number; combatId?: string },
  foundryClient: FoundryClient,
) {
  const { combatantId, initiative, combatId } = args;

  if (!combatantId || typeof combatantId !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'combatantId is required and must be a string');
  }
  if (typeof initiative !== 'number' || !Number.isFinite(initiative)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'initiative is required and must be a finite number',
    );
  }

  const activeCombat = foundryClient.getCombatState();
  const resolvedCombatId = combatId ?? activeCombat?._id;
  if (!resolvedCombatId) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'No active combat and no combatId provided; cannot set initiative.',
    );
  }

  // Only the active combat is readable from the world-data cache, so only its
  // turn order can be recomputed. Capture who is acting BEFORE the write.
  const combat = activeCombat?._id === resolvedCombatId ? activeCombat : undefined;
  const acting = combat ? getCurrentCombatant(combat) : undefined;

  return withToolError('set combatant initiative', async () => {
    await foundryClient.setCombatantInitiative(resolvedCombatId, combatantId, initiative);

    let reanchored = '';
    if (combat && acting) {
      const turn = turnIndexAfterInitiativeChange(combat, { combatantId, initiative }, acting._id);
      if (turn !== undefined && turn !== combat.turn) {
        await foundryClient.updateCombat(resolvedCombatId, { turn });
        reanchored = `
**Still acting:** ${acting.name} (turn ${turn + 1} of ${combat.combatants.length})`;
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: `⚔️ **Initiative Set**
**Combat:** ${resolvedCombatId}
**Combatant:** ${combatantId}
**Initiative:** ${initiative}${reanchored}`,
        },
      ],
    };
  });
}

/**
 * Starts a new combat encounter, seeding combatants from tokens (FR-018, #172).
 *
 * Resolves the target scene (explicit `sceneId`, else the active scene), then
 * builds combatant seeds from the requested `tokenIds` (or every token on the
 * scene when none are given) and delegates the two-step create to the client.
 */
export async function handleStartCombat(
  args: { tokenIds?: string[]; sceneId?: string },
  foundryClient: FoundryClient,
) {
  const { tokenIds, sceneId } = args ?? {};

  const scenes = foundryClient.getScenes();
  const scene: WorldScene | undefined = sceneId
    ? scenes.find((s) => s._id === sceneId)
    : scenes.find((s) => s.active);

  if (!scene) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      sceneId
        ? `Scene not found: ${sceneId}`
        : 'No active scene to start combat on; provide a sceneId.',
    );
  }

  const sceneTokens = scene.tokens ?? [];
  const tokenIdOf = (t: Record<string, unknown>): string | undefined =>
    typeof t._id === 'string' ? t._id : undefined;
  const actorIdOf = (t: Record<string, unknown>): string | undefined =>
    typeof t.actorId === 'string' ? t.actorId : undefined;

  const seeds: CombatantSeed[] = [];
  if (tokenIds && tokenIds.length > 0) {
    for (const id of tokenIds) {
      const token = sceneTokens.find((t) => tokenIdOf(t) === id);
      if (!token) {
        throw new McpError(ErrorCode.InvalidParams, `Token not found on scene ${scene._id}: ${id}`);
      }
      seeds.push({ tokenId: id, sceneId: scene._id, actorId: actorIdOf(token) });
    }
  } else {
    for (const t of sceneTokens) {
      const id = tokenIdOf(t);
      if (id) {
        seeds.push({ tokenId: id, sceneId: scene._id, actorId: actorIdOf(t) });
      }
    }
  }

  return withToolError('start combat', async () => {
    const { combatId, combatantCount } = await foundryClient.startCombat(scene._id, seeds);

    return {
      content: [
        {
          type: 'text',
          text: `⚔️ **Combat Started**
**Encounter:** ${combatId}
**Scene:** ${scene.name} (${scene._id})
**Combatants:** ${combatantCount}`,
        },
      ],
    };
  });
}
