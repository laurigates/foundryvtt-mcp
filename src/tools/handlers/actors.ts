/**
 * @fileoverview Actor management tool handlers
 *
 * Handles searching for actors and retrieving detailed actor information.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { FoundryActor } from '../../foundry/types.js';
import type { FoundryCore } from '../../providers/types.js';
import { withToolError } from './utils.js';

/**
 * Printed for a value the game system computes client-side and the Socket.IO
 * source data does not carry (#308). `Unknown` or `+0` would read as real data.
 */
const DERIVED_UNAVAILABLE =
  'not available in Socket.IO mode (computed client-side by the game system)';

function formatBonus(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function isDerivedUnavailable(
  actor: FoundryActor,
  field: NonNullable<FoundryActor['derivedUnavailable']>[number],
): boolean {
  return actor.derivedUnavailable?.includes(field) ?? false;
}

/**
 * Handles actor search requests
 */
export async function handleSearchActors(
  args: {
    query?: string;
    type?: string;
    limit?: number;
  },
  provider: FoundryCore,
) {
  const { query, type, limit = 10 } = args;

  return withToolError('search actors', async () => {
    const searchParams: { query: string; type?: string; limit: number } = {
      query: query || '',
      limit,
    };
    if (type) {
      searchParams.type = type;
    }
    const result = await provider.searchActors(searchParams);

    const actorList = result.actors
      .map((actor) => {
        const hpText = isDerivedUnavailable(actor, 'hpMax')
          ? `${actor.hp?.value ?? 'Unknown'} (max not available in Socket.IO mode)`
          : `${actor.hp?.value ?? 'Unknown'}/${actor.hp?.max ?? 'Unknown'}`;
        return `- **${actor.name}** (${actor.type}) - Level ${actor.level ?? 'Unknown'} - HP: ${hpText}`;
      })
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `🎭 **Actor Search Results**
**Query:** ${query || 'All actors'}
**Type Filter:** ${type || 'All types'}
**Results:** ${result.actors.length}/${result.total} total

${actorList || 'No actors found matching the criteria.'}

**Page:** ${result.page} | **Limit:** ${result.limit}`,
        },
      ],
    };
  });
}

/**
 * Handles detailed actor information requests
 */
export async function handleGetActorDetails(
  args: {
    actorId: string;
  },
  provider: FoundryCore,
) {
  const { actorId } = args;

  if (!actorId || typeof actorId !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Actor ID is required and must be a string');
  }

  return withToolError('get actor details', async () => {
    const actor = await provider.getActor(actorId);

    const abilities = actor.abilities
      ? Object.entries(actor.abilities)
          .map(
            ([key, ability]: [string, { value: number; mod: number }]) =>
              `**${key.toUpperCase()}:** ${ability.value} (${ability.mod >= 0 ? '+' : ''}${ability.mod})`,
          )
          .join('\n')
      : 'No ability scores available';

    const hitPoints = isDerivedUnavailable(actor, 'hpMax')
      ? `${actor.hp?.value ?? 'Unknown'}, max ${DERIVED_UNAVAILABLE}`
      : `${actor.hp?.value ?? 'Unknown'}/${actor.hp?.max ?? 'Unknown'}`;
    const armorClass = isDerivedUnavailable(actor, 'ac')
      ? DERIVED_UNAVAILABLE
      : (actor.ac?.value ?? 'Unknown');
    const prof = actor.attributes?.prof;
    const proficiencyLine =
      typeof prof === 'number' ? `\n**Proficiency Bonus:** ${formatBonus(prof)}` : '';
    // Save totals are prepared values: only the REST bridge reports them.
    const saves = Object.entries(actor.abilities ?? {}).flatMap(([key, ability]) =>
      typeof ability.save === 'number' ? [`${key.toUpperCase()} ${formatBonus(ability.save)}`] : [],
    );
    const savesLine = saves.length > 0 ? `\n**Saving Throws:** ${saves.join(', ')}` : '';

    return {
      content: [
        {
          type: 'text',
          text: `🎭 **Actor Details: ${actor.name}**
**Type:** ${actor.type}
**Level:** ${actor.level ?? 'Unknown'}${proficiencyLine}
**Hit Points:** ${hitPoints}
**Armor Class:** ${armorClass}

**Ability Scores:**
${abilities}${savesLine}

**Description:** ${(actor as { description?: string }).description || 'No description available.'}`,
        },
      ],
    };
  });
}
