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
import type { WorldCombat } from '../../foundry/types.js';
import { withToolError } from './utils.js';

/**
 * Computes the next `{ turn, round }` for an active combat.
 *
 * Advances to the next combatant in order; wrapping past the last combatant
 * rolls over to turn 0 of the next round.
 *
 * Known limitation: this does NOT skip `defeated` combatants the way Foundry's
 * `Combat#nextTurn` does with `skipDefeated`. Turn order is treated as the raw
 * combatant array order. Defeated-skipping is deferred to a follow-up.
 *
 * @throws if the combat has no combatants (cannot advance an empty encounter).
 */
export function computeNextTurn(combat: WorldCombat): { turn: number; round: number } {
  const n = combat.combatants.length;
  if (n === 0) {
    throw new Error('Cannot advance turn: active combat has no combatants');
  }
  const cur = combat.turn ?? 0;
  const next = cur + 1;
  if (next >= n) {
    return { turn: 0, round: combat.round + 1 };
  }
  return { turn: next, round: combat.round };
}

/**
 * Advances the active combat to the next turn (FR-018).
 */
export async function handleNextTurn(_args: Record<string, unknown>, foundryClient: FoundryClient) {
  const combat = foundryClient.getCombatState();
  if (!combat) {
    throw new McpError(ErrorCode.InvalidRequest, 'No active combat to advance.');
  }

  return withToolError('advance combat turn', async () => {
    const { turn, round } = computeNextTurn(combat);
    await foundryClient.updateCombat(combat._id, { turn, round });

    const current = combat.combatants[turn];
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

  const resolvedCombatId = combatId ?? foundryClient.getCombatState()?._id;
  if (!resolvedCombatId) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'No active combat and no combatId provided; cannot set initiative.',
    );
  }

  return withToolError('set combatant initiative', async () => {
    await foundryClient.setCombatantInitiative(resolvedCombatId, combatantId, initiative);

    return {
      content: [
        {
          type: 'text',
          text: `⚔️ **Initiative Set**
**Combat:** ${resolvedCombatId}
**Combatant:** ${combatantId}
**Initiative:** ${initiative}`,
        },
      ],
    };
  });
}
