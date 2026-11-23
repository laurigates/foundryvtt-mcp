/**
 * @fileoverview Unit tests for actor handlers — search and get details
 */

import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import type { FoundryClient } from '../../../foundry/client.js';
import type { ActorSearchResult, FoundryActor } from '../../../foundry/types.js';
import { handleGetActorDetails, handleSearchActors } from '../actors.js';

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]?.text ?? '';
}

function buildActor(overrides: Partial<FoundryActor> = {}): FoundryActor {
  return {
    _id: 'actor-1',
    name: 'Hero',
    type: 'character',
    level: 3,
    hp: { value: 20, max: 25 },
    ac: { value: 15 },
    abilities: {
      str: { value: 16, mod: 3 },
      dex: { value: 14, mod: 2 },
    },
    ...overrides,
  };
}

describe('handleSearchActors', () => {
  it('returns a formatted list of actors on happy path', async () => {
    const actors: FoundryActor[] = [
      buildActor({
        _id: 'a1',
        name: 'Aragorn',
        type: 'character',
        level: 5,
        hp: { value: 30, max: 40 },
      }),
      buildActor({ _id: 'a2', name: 'Goblin', type: 'npc', level: 1, hp: { value: 7, max: 7 } }),
    ];
    const searchResult: ActorSearchResult = { actors, total: 2, page: 1, limit: 10 };
    const client = {
      searchActors: vi.fn().mockResolvedValue(searchResult),
    } as unknown as FoundryClient;

    const result = await handleSearchActors({ query: 'a' }, client);
    const text = getText(result);

    expect(client.searchActors).toHaveBeenCalledWith({ query: 'a', limit: 10 });
    expect(text).toContain('Aragorn');
    expect(text).toContain('Goblin');
    expect(text).toContain('Level 5');
    expect(text).toContain('HP: 30/40');
    expect(text).toContain('**Results:** 2/2');
  });

  it('preserves zero current and maximum HP and level in actor search results', async () => {
    const actors: FoundryActor[] = [
      buildActor({ name: 'Fallen Hero', hp: { value: 0, max: 25 } }),
      buildActor({ name: 'Zero HP Creature', level: 0, hp: { value: 0, max: 0 } }),
    ];
    const client = {
      searchActors: vi.fn().mockResolvedValue({
        actors,
        total: 2,
        page: 1,
        limit: 10,
      } satisfies ActorSearchResult),
    } as unknown as FoundryClient;

    const result = await handleSearchActors({ query: '' }, client);
    const text = getText(result);

    expect(text).toContain('**Fallen Hero** (character) - Level 3 - HP: 0/25');
    expect(text).toContain('**Zero HP Creature** (character) - Level 0 - HP: 0/0');
    expect(text).not.toContain('HP: Unknown');
  });

  it('renders a present HP value with a missing maximum as Unknown in search results', async () => {
    const actors: FoundryActor[] = [
      buildActor({ name: 'Wounded', hp: { value: 20, max: undefined } }),
    ];
    const client = {
      searchActors: vi.fn().mockResolvedValue({
        actors,
        total: 1,
        page: 1,
        limit: 10,
      } satisfies ActorSearchResult),
    } as unknown as FoundryClient;

    const result = await handleSearchActors({ query: '' }, client);
    const text = getText(result);

    expect(text).toContain('**Wounded** (character) - Level 3 - HP: 20/Unknown');
  });

  it('passes through type filter when supplied', async () => {
    const searchResult: ActorSearchResult = { actors: [], total: 0, page: 1, limit: 5 };
    const client = {
      searchActors: vi.fn().mockResolvedValue(searchResult),
    } as unknown as FoundryClient;

    await handleSearchActors({ query: 'gob', type: 'npc', limit: 5 }, client);

    expect(client.searchActors).toHaveBeenCalledWith({ query: 'gob', type: 'npc', limit: 5 });
  });

  it('shows "No actors found" placeholder on empty result', async () => {
    const searchResult: ActorSearchResult = { actors: [], total: 0, page: 1, limit: 10 };
    const client = {
      searchActors: vi.fn().mockResolvedValue(searchResult),
    } as unknown as FoundryClient;

    const result = await handleSearchActors({ query: 'nonexistent' }, client);
    const text = getText(result);

    expect(text).toContain('No actors found matching the criteria.');
    expect(text).toContain('**Results:** 0/0');
  });

  it('shows "All actors" when no query provided', async () => {
    const searchResult: ActorSearchResult = { actors: [], total: 0, page: 1, limit: 10 };
    const client = {
      searchActors: vi.fn().mockResolvedValue(searchResult),
    } as unknown as FoundryClient;

    const result = await handleSearchActors({}, client);
    const text = getText(result);

    expect(text).toContain('**Query:** All actors');
    expect(client.searchActors).toHaveBeenCalledWith({ query: '', limit: 10 });
  });

  it('falls back to "Unknown" when level and hp are missing', async () => {
    const actors: FoundryActor[] = [
      buildActor({ name: 'Mystery', level: undefined, hp: undefined }),
    ];
    const searchResult: ActorSearchResult = { actors, total: 1, page: 1, limit: 10 };
    const client = {
      searchActors: vi.fn().mockResolvedValue(searchResult),
    } as unknown as FoundryClient;

    const result = await handleSearchActors({ query: 'm' }, client);
    const text = getText(result);

    expect(text).toContain('Level Unknown');
    expect(text).toContain('HP: Unknown/Unknown');
  });

  it('labels an HP maximum the game system derives client-side (#308)', async () => {
    const actors: FoundryActor[] = [
      buildActor({ name: 'Source Paladin', hp: { value: 51 }, derivedUnavailable: ['hpMax'] }),
    ];
    const client = {
      searchActors: vi.fn().mockResolvedValue({
        actors,
        total: 1,
        page: 1,
        limit: 10,
      } satisfies ActorSearchResult),
    } as unknown as FoundryClient;

    const text = getText(await handleSearchActors({ query: '' }, client));

    expect(text).toContain(
      '**Source Paladin** (character) - Level 3 - HP: 51 (max not available in Socket.IO mode)',
    );
    expect(text).not.toContain('Unknown');
  });

  it('wraps client errors in McpError', async () => {
    const client = {
      searchActors: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as FoundryClient;

    await expect(handleSearchActors({ query: 'x' }, client)).rejects.toThrow(McpError);
  });
});

describe('handleGetActorDetails', () => {
  it('returns formatted actor details on happy path', async () => {
    const actor = buildActor({ name: 'Legolas', type: 'character', level: 7 });
    const client = {
      getActor: vi.fn().mockResolvedValue(actor),
    } as unknown as FoundryClient;

    const result = await handleGetActorDetails({ actorId: 'actor-1' }, client);
    const text = getText(result);

    expect(client.getActor).toHaveBeenCalledWith('actor-1');
    expect(text).toContain('Legolas');
    expect(text).toContain('**Type:** character');
    expect(text).toContain('**Level:** 7');
    expect(text).toContain('**Hit Points:** 20/25');
    expect(text).toContain('**Armor Class:** 15');
    expect(text).toContain('**STR:** 16 (+3)');
    expect(text).toContain('**DEX:** 14 (+2)');
  });

  it('preserves zero HP, maximum HP, armor class and level in actor details', async () => {
    const actor = buildActor({
      name: 'Unconscious Hero',
      level: 0,
      hp: { value: 0, max: 0 },
      ac: { value: 0 },
    });
    const client = {
      getActor: vi.fn().mockResolvedValue(actor),
    } as unknown as FoundryClient;

    const result = await handleGetActorDetails({ actorId: actor._id }, client);
    const text = getText(result);

    expect(text).toContain('**Level:** 0');
    expect(text).toContain('**Hit Points:** 0/0');
    expect(text).toContain('**Armor Class:** 0');
    expect(text).not.toContain('**Hit Points:** Unknown');
  });

  it('uses Unknown for missing numeric stats without masking zero values', async () => {
    const actor = buildActor({
      level: undefined,
      hp: undefined,
      ac: undefined,
    });
    const client = {
      getActor: vi.fn().mockResolvedValue(actor),
    } as unknown as FoundryClient;

    const result = await handleGetActorDetails({ actorId: actor._id }, client);
    const text = getText(result);

    expect(text).toContain('**Level:** Unknown');
    expect(text).toContain('**Hit Points:** Unknown/Unknown');
    expect(text).toContain('**Armor Class:** Unknown');
  });

  it('renders a present HP value with a missing maximum as Unknown in actor details', async () => {
    const actor = buildActor({ hp: { value: 20, max: undefined } });
    const client = {
      getActor: vi.fn().mockResolvedValue(actor),
    } as unknown as FoundryClient;

    const result = await handleGetActorDetails({ actorId: actor._id }, client);
    const text = getText(result);

    expect(text).toContain('**Hit Points:** 20/Unknown');
  });

  it('throws McpError with InvalidParams when actorId is missing', async () => {
    const client = { getActor: vi.fn() } as unknown as FoundryClient;

    await expect(handleGetActorDetails({ actorId: '' }, client)).rejects.toThrow(McpError);
    expect(client.getActor).not.toHaveBeenCalled();
  });

  it('throws McpError when actorId is not a string', async () => {
    const client = { getActor: vi.fn() } as unknown as FoundryClient;

    await expect(
      handleGetActorDetails({ actorId: 123 as unknown as string }, client),
    ).rejects.toThrow(McpError);
    expect(client.getActor).not.toHaveBeenCalled();
  });

  it('shows fallback text when abilities are missing', async () => {
    const actor = buildActor({ abilities: undefined });
    const client = {
      getActor: vi.fn().mockResolvedValue(actor),
    } as unknown as FoundryClient;

    const result = await handleGetActorDetails({ actorId: 'actor-1' }, client);
    const text = getText(result);

    expect(text).toContain('No ability scores available');
  });

  it('formats negative ability modifiers without an extra sign', async () => {
    const actor = buildActor({
      abilities: { str: { value: 8, mod: -1 } },
    });
    const client = {
      getActor: vi.fn().mockResolvedValue(actor),
    } as unknown as FoundryClient;

    const result = await handleGetActorDetails({ actorId: 'actor-1' }, client);
    const text = getText(result);

    expect(text).toContain('**STR:** 8 (-1)');
  });

  describe('values the game system derives client-side (#308)', () => {
    const LABEL = 'not available in Socket.IO mode (computed client-side by the game system)';

    it('labels an unavailable armor class instead of printing Unknown', async () => {
      const actor = buildActor({ ac: undefined, derivedUnavailable: ['ac'] });
      const client = { getActor: vi.fn().mockResolvedValue(actor) } as unknown as FoundryClient;

      const text = getText(await handleGetActorDetails({ actorId: actor._id }, client));

      expect(text).toContain(`**Armor Class:** ${LABEL}`);
      expect(text).not.toContain('**Armor Class:** Unknown');
    });

    it('labels an unavailable HP maximum and keeps the current HP', async () => {
      const actor = buildActor({ hp: { value: 51 }, derivedUnavailable: ['hpMax'] });
      const client = { getActor: vi.fn().mockResolvedValue(actor) } as unknown as FoundryClient;

      const text = getText(await handleGetActorDetails({ actorId: actor._id }, client));

      expect(text).toContain(`**Hit Points:** 51, max ${LABEL}`);
    });

    it('prints the proficiency bonus when it is known', async () => {
      const actor = buildActor({ level: 10, attributes: { prof: 4 } });
      const client = { getActor: vi.fn().mockResolvedValue(actor) } as unknown as FoundryClient;

      const text = getText(await handleGetActorDetails({ actorId: actor._id }, client));

      expect(text).toContain('**Proficiency Bonus:** +4');
    });

    it('omits the proficiency bonus line when it is not known', async () => {
      const actor = buildActor();
      const client = { getActor: vi.fn().mockResolvedValue(actor) } as unknown as FoundryClient;

      const text = getText(await handleGetActorDetails({ actorId: actor._id }, client));

      expect(text).not.toContain('Proficiency Bonus');
    });
  });

  it('wraps fetch errors in McpError', async () => {
    const client = {
      getActor: vi.fn().mockRejectedValue(new Error('not found')),
    } as unknown as FoundryClient;

    await expect(handleGetActorDetails({ actorId: 'actor-1' }, client)).rejects.toThrow(McpError);
  });
});
