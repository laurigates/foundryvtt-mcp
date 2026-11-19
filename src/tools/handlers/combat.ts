/**
 * Combat state tool handler
 */

import type { FoundryCore } from '../../providers/types.js';
import { getTurnOrder } from './combat-order.js';
import { withToolError } from './utils.js';

export async function handleGetCombatState(_args: Record<string, unknown>, provider: FoundryCore) {
  return withToolError('get combat state', async () => {
    const combat = provider.getCombatState();

    if (!combat) {
      return {
        content: [{ type: 'text', text: 'No active combat encounter.' }],
      };
    }

    // `combat` is a live reference into the world-data cache: sort a COPY via
    // the shared helper so a read never reorders cached state (#214). The same
    // helper backs `next_turn`, so both tools agree on what `combat.turn` means.
    const combatants = (
      await Promise.all(
        getTurnOrder(combat).map(async (c, i) => {
          const current = combat.turn === i ? ' <-- CURRENT' : '';
          const status = c.defeated ? ' [DEFEATED]' : c.hidden ? ' [HIDDEN]' : '';
          const init = c.initiative !== null ? c.initiative.toString() : '?';

          // Render the provider's system projection; this handler does not interpret Actor.system.
          let hpAc = '';
          if (c.actorId) {
            const actor = await provider.getActor(c.actorId).catch(() => undefined);
            if (actor?.hp) {
              hpAc += ` HP: ${actor.hp.value ?? '?'}/${actor.hp.max ?? '?'}`;
            }
            if (actor?.ac) {
              hpAc += ` AC: ${actor.ac.value ?? '?'}`;
            }
          }

          return `${i + 1}. [${init}] **${c.name}**${hpAc}${status}${current}`;
        }),
      )
    ).join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `**Active Combat** — Round ${combat.round}\n\n${combatants}`,
        },
      ],
    };
  });
}
