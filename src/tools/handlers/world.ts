/**
 * World-level tool handlers: cross-collection search, summary, refresh
 */

import type { FoundryClient } from '../../foundry/client.js';
import { withToolError } from './utils.js';

export async function handleSearchWorld(
  args: { query: string; limit?: number },
  foundryClient: FoundryClient,
) {
  return withToolError('search world', async () => {
    const results = foundryClient.searchWorld(args.query);
    const limit = args.limit || 5;

    const sections: string[] = [];

    if (results.actors.length > 0) {
      const items = results.actors
        .slice(0, limit)
        .map((a) => `  - ${a.name} (${a.type})`)
        .join('\n');
      sections.push(`**Actors** (${results.actors.length})\n${items}`);
    }
    if (results.items.length > 0) {
      const items = results.items
        .slice(0, limit)
        .map((i) => `  - ${i.name} (${i.type})`)
        .join('\n');
      sections.push(`**Items** (${results.items.length})\n${items}`);
    }
    if (results.scenes.length > 0) {
      const items = results.scenes
        .slice(0, limit)
        .map((s) => `  - ${s.name}${s.active ? ' [ACTIVE]' : ''}`)
        .join('\n');
      sections.push(`**Scenes** (${results.scenes.length})\n${items}`);
    }
    if (results.journals.length > 0) {
      const items = results.journals
        .slice(0, limit)
        .map((j) => `  - ${j.name}`)
        .join('\n');
      sections.push(`**Journals** (${results.journals.length})\n${items}`);
    }

    if (sections.length === 0) {
      return {
        content: [{ type: 'text', text: `No results found for "${args.query}".` }],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `**World Search** — "${args.query}"\n\n${sections.join('\n\n')}`,
        },
      ],
    };
  });
}

export async function handleGetWorldSummary(
  _args: Record<string, unknown>,
  foundryClient: FoundryClient,
) {
  return withToolError('get world summary', async () => {
    const worldInfo = await foundryClient.getWorldInfo();
    const counts = foundryClient.getWorldSummary();

    const countLines = Object.entries(counts)
      .map(([key, count]) => `- **${key}**: ${count}`)
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `**World: ${worldInfo.title}**
**System:** ${worldInfo.system} (${worldInfo.systemVersion})
**Core Version:** ${worldInfo.coreVersion}

**Collection Counts:**
${countLines || 'No data available — not connected.'}`,
        },
      ],
    };
  });
}

export async function handleRefreshWorldData(
  _args: Record<string, unknown>,
  foundryClient: FoundryClient,
) {
  return withToolError('refresh world data', async () => {
    await foundryClient.refreshWorldData();
    const counts = foundryClient.getWorldSummary();

    const countLines = Object.entries(counts)
      .map(([key, count]) => `- **${key}**: ${count}`)
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `World data refreshed successfully.\n\n**Collection Counts:**\n${countLines}`,
        },
      ],
    };
  });
}
