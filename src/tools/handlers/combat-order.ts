/**
 * @fileoverview Shared combatant turn-order helper (#214).
 *
 * FoundryVTT resolves `Combat#turn` against the **initiative-sorted** turn
 * order, not the stored (creation) order of `Combat#combatants`. Every handler
 * that maps a `turn` index onto a combatant — the read path
 * (`get_combat_state`) and the write path (`next_turn`) alike — must therefore
 * derive that list here, so the two can never drift apart through slightly
 * different comparators.
 *
 * The comparator mirrors core's `Combat._sortCombatants`: initiative
 * descending, non-numeric (un-rolled) initiative last, ties broken by document
 * id so the order is deterministic and stable.
 */

import type { WorldCombat } from '../../foundry/types.js';

/** A single combatant embedded in a `WorldCombat` document. */
export type WorldCombatant = WorldCombat['combatants'][number];

/** Un-rolled / malformed initiative sorts to the very end of the order. */
function initiativeOf(c: WorldCombatant): number {
  return typeof c.initiative === 'number' && Number.isFinite(c.initiative)
    ? c.initiative
    : Number.NEGATIVE_INFINITY;
}

/**
 * Compares two combatants by Foundry's turn-order rules.
 *
 * Initiative descending; combatants without a rolled initiative go last; ties
 * (including two un-rolled combatants, whose difference is `NaN`) fall back to
 * the document id so the ordering is total and deterministic.
 */
export function compareCombatants(a: WorldCombatant, b: WorldCombatant): number {
  const byInitiative = initiativeOf(b) - initiativeOf(a);
  if (byInitiative && !Number.isNaN(byInitiative)) {
    return byInitiative;
  }
  if (a._id === b._id) {
    return 0;
  }
  return a._id > b._id ? 1 : -1;
}

/**
 * Returns the combatants of `combat` in turn order.
 *
 * Sorts a **copy** — `combat` is a live reference into the world-data cache, so
 * sorting in place would silently reorder cached state as a side effect of a
 * read.
 */
export function getTurnOrder(combat: WorldCombat): WorldCombatant[] {
  return [...combat.combatants].sort(compareCombatants);
}

/**
 * Returns the combatant `combat.turn` currently points at, if any.
 *
 * Yields `undefined` when nobody is acting yet — the encounter has not been
 * started (initiatives are commonly assigned during round 0 setup), `turn` is
 * null, or the stored index no longer resolves to a combatant.
 */
export function getCurrentCombatant(combat: WorldCombat): WorldCombatant | undefined {
  if (!combat.started || combat.turn === null || combat.turn === undefined) {
    return undefined;
  }
  return getTurnOrder(combat)[combat.turn];
}

/**
 * Computes where `actingCombatantId` lands in the turn order once `change` is
 * applied — i.e. the `turn` index that keeps the same combatant acting.
 *
 * The change is projected onto a copy rather than read back from the cache:
 * `setCombatantInitiative` resolves on the `modifyDocument` ack, while the
 * cache is updated by the separate broadcast, so the cached initiative may or
 * may not have caught up by the time this runs. Projecting is correct either
 * way (re-applying the same value is a no-op).
 *
 * @returns the new index, or `undefined` if the acting combatant is gone.
 */
export function turnIndexAfterInitiativeChange(
  combat: WorldCombat,
  change: { combatantId: string; initiative: number },
  actingCombatantId: string,
): number | undefined {
  const projected: WorldCombat = {
    ...combat,
    combatants: combat.combatants.map((c) =>
      c._id === change.combatantId ? { ...c, initiative: change.initiative } : c,
    ),
  };
  const index = getTurnOrder(projected).findIndex((c) => c._id === actingCombatantId);
  return index === -1 ? undefined : index;
}
