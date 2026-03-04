/**
 * Combat state tool handler
 */

import type { FoundryClient } from '../../foundry/client.js';
import { withToolError } from './utils.js';

export async function handleGetCombatState(
  _args: Record<string, unknown>,
  foundryClient: FoundryClient,
) {
  return withToolError('get combat state', async () => {
    const combat = foundryClient.getCombatState();

    if (!combat) {
      return {
        content: [{ type: 'text', text: 'No active combat encounter.' }],
      };
    }

    const combatants = combat.combatants
      .sort((a, b) => (b.initiative ?? -999) - (a.initiative ?? -999))
      .map((c, i) => {
        const current = combat.turn === i ? ' <-- CURRENT' : '';
        const status = c.defeated ? ' [DEFEATED]' : c.hidden ? ' [HIDDEN]' : '';
        const init = c.initiative !== null ? c.initiative.toString() : '?';

        // Try to get HP/AC from worldData if actor is linked
        let hpAc = '';
        if (c.actorId) {
          const actor = foundryClient.getRawActor(c.actorId);
          if (actor) {
            const hp = actor.system?.attributes as Record<string, unknown> | undefined;
            const hpData = hp?.hp as { value?: number; max?: number } | undefined;
            const acData = hp?.ac as { value?: number } | undefined;
            if (hpData) {
              hpAc += ` HP: ${hpData.value ?? '?'}/${hpData.max ?? '?'}`;
            }
            if (acData) {
              hpAc += ` AC: ${acData.value ?? '?'}`;
            }
          }
        }

        return `${i + 1}. [${init}] **${c.name}**${hpAc}${status}${current}`;
      })
      .join('\n');

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
