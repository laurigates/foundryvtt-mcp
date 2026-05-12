/**
 * @fileoverview Unit tests for world handlers — search, summary, refresh
 */

import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import type { FoundryClient } from '../../../foundry/client.js';
import type {
  FoundryWorld,
  WorldActor,
  WorldItem,
  WorldJournal,
  WorldScene,
} from '../../../foundry/types.js';
import {
  handleGetWorldSummary,
  handleRefreshWorldData,
  handleSearchWorld,
} from '../world.js';

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]?.text ?? '';
}

function buildActor(name: string, type = 'character'): WorldActor {
  return { _id: `a-${name}`, name, type, system: {} };
}

function buildItem(name: string, type = 'weapon'): WorldItem {
  return { _id: `i-${name}`, name, type, system: {} };
}

function buildScene(name: string, active = false): WorldScene {
  return {
    _id: `s-${name}`,
    name,
    active,
    navigation: true,
    width: 0,
    height: 0,
    padding: 0,
    darkness: 0,
    globalLight: false,
  };
}

function buildJournal(name: string): WorldJournal {
  return { _id: `j-${name}`, name };
}

describe('handleSearchWorld', () => {
  it('formats results across all collections on happy path', async () => {
    const client = {
      searchWorld: vi.fn().mockReturnValue({
        actors: [buildActor('Wizard')],
        items: [buildItem('Wand')],
        scenes: [buildScene('Tower', true)],
        journals: [buildJournal('Lore')],
      }),
    } as unknown as FoundryClient;

    const result = await handleSearchWorld({ query: 'w' }, client);
    const text = getText(result);

    expect(client.searchWorld).toHaveBeenCalledWith('w');
    expect(text).toContain('**World Search** — "w"');
    expect(text).toContain('**Actors** (1)');
    expect(text).toContain('Wizard (character)');
    expect(text).toContain('**Items** (1)');
    expect(text).toContain('Wand (weapon)');
    expect(text).toContain('**Scenes** (1)');
    expect(text).toContain('Tower [ACTIVE]');
    expect(text).toContain('**Journals** (1)');
    expect(text).toContain('Lore');
  });

  it('limits each section to the configured limit (default 5)', async () => {
    const actors = Array.from({ length: 10 }, (_, i) => buildActor(`A${i}`));
    const client = {
      searchWorld: vi.fn().mockReturnValue({
        actors,
        items: [],
        scenes: [],
        journals: [],
      }),
    } as unknown as FoundryClient;

    const result = await handleSearchWorld({ query: 'a' }, client);
    const text = getText(result);

    // header reports total (10), but only 5 entries are listed
    expect(text).toContain('**Actors** (10)');
    const listedActors = text.split('\n').filter((line) => line.startsWith('  - A'));
    expect(listedActors).toHaveLength(5);
  });

  it('respects an explicit limit override', async () => {
    const actors = Array.from({ length: 10 }, (_, i) => buildActor(`A${i}`));
    const client = {
      searchWorld: vi.fn().mockReturnValue({
        actors,
        items: [],
        scenes: [],
        journals: [],
      }),
    } as unknown as FoundryClient;

    const result = await handleSearchWorld({ query: 'a', limit: 2 }, client);
    const text = getText(result);

    const listedActors = text.split('\n').filter((line) => line.startsWith('  - A'));
    expect(listedActors).toHaveLength(2);
  });

  it('returns a "no results" message when all collections are empty', async () => {
    const client = {
      searchWorld: vi.fn().mockReturnValue({ actors: [], items: [], scenes: [], journals: [] }),
    } as unknown as FoundryClient;

    const result = await handleSearchWorld({ query: 'zzz' }, client);
    const text = getText(result);

    expect(text).toBe('No results found for "zzz".');
  });

  it('omits sections that have no matches', async () => {
    const client = {
      searchWorld: vi.fn().mockReturnValue({
        actors: [buildActor('Hero')],
        items: [],
        scenes: [],
        journals: [],
      }),
    } as unknown as FoundryClient;

    const result = await handleSearchWorld({ query: 'h' }, client);
    const text = getText(result);

    expect(text).toContain('**Actors** (1)');
    expect(text).not.toContain('**Items**');
    expect(text).not.toContain('**Scenes**');
    expect(text).not.toContain('**Journals**');
  });

  it('wraps client errors in McpError', async () => {
    const client = {
      searchWorld: vi.fn(() => {
        throw new Error('boom');
      }),
    } as unknown as FoundryClient;

    await expect(handleSearchWorld({ query: 'a' }, client)).rejects.toThrow(McpError);
  });
});

describe('handleGetWorldSummary', () => {
  it('returns formatted world info and counts on happy path', async () => {
    const worldInfo: FoundryWorld = {
      id: 'world-1',
      title: 'My Campaign',
      description: '',
      system: 'dnd5e',
      coreVersion: '13.348',
      systemVersion: '4.0.0',
      playtime: 0,
      created: '',
      modified: '',
    };
    const client = {
      getWorldInfo: vi.fn().mockResolvedValue(worldInfo),
      getWorldSummary: vi.fn().mockReturnValue({ actors: 12, items: 50 }),
    } as unknown as FoundryClient;

    const result = await handleGetWorldSummary({}, client);
    const text = getText(result);

    expect(text).toContain('**World: My Campaign**');
    expect(text).toContain('**System:** dnd5e (4.0.0)');
    expect(text).toContain('**Core Version:** 13.348');
    expect(text).toContain('- **actors**: 12');
    expect(text).toContain('- **items**: 50');
  });

  it('shows fallback when summary returns no entries', async () => {
    const worldInfo: FoundryWorld = {
      id: 'world-1',
      title: 'Empty',
      description: '',
      system: 'dnd5e',
      coreVersion: '13.0',
      systemVersion: '4.0',
      playtime: 0,
      created: '',
      modified: '',
    };
    const client = {
      getWorldInfo: vi.fn().mockResolvedValue(worldInfo),
      getWorldSummary: vi.fn().mockReturnValue({}),
    } as unknown as FoundryClient;

    const result = await handleGetWorldSummary({}, client);
    const text = getText(result);

    expect(text).toContain('No data available — not connected.');
  });

  it('wraps getWorldInfo errors in McpError', async () => {
    const client = {
      getWorldInfo: vi.fn().mockRejectedValue(new Error('offline')),
      getWorldSummary: vi.fn().mockReturnValue({}),
    } as unknown as FoundryClient;

    await expect(handleGetWorldSummary({}, client)).rejects.toThrow(McpError);
  });
});

describe('handleRefreshWorldData', () => {
  it('calls refresh and reports the new collection counts', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const client = {
      refreshWorldData: refresh,
      getWorldSummary: vi.fn().mockReturnValue({ actors: 3, items: 7 }),
    } as unknown as FoundryClient;

    const result = await handleRefreshWorldData({}, client);
    const text = getText(result);

    expect(refresh).toHaveBeenCalled();
    expect(text).toContain('World data refreshed successfully.');
    expect(text).toContain('- **actors**: 3');
    expect(text).toContain('- **items**: 7');
  });

  it('wraps refresh errors in McpError', async () => {
    const client = {
      refreshWorldData: vi.fn().mockRejectedValue(new Error('socket lost')),
      getWorldSummary: vi.fn().mockReturnValue({}),
    } as unknown as FoundryClient;

    await expect(handleRefreshWorldData({}, client)).rejects.toThrow(McpError);
  });

  it('produces a result even when getWorldSummary returns no entries', async () => {
    const client = {
      refreshWorldData: vi.fn().mockResolvedValue(undefined),
      getWorldSummary: vi.fn().mockReturnValue({}),
    } as unknown as FoundryClient;

    const result = await handleRefreshWorldData({}, client);
    const text = getText(result);

    expect(text).toContain('World data refreshed successfully.');
  });
});
