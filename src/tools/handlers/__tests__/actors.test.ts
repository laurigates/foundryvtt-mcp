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

  it('wraps fetch errors in McpError', async () => {
    const client = {
      getActor: vi.fn().mockRejectedValue(new Error('not found')),
    } as unknown as FoundryClient;

    await expect(handleGetActorDetails({ actorId: 'actor-1' }, client)).rejects.toThrow(McpError);
  });
});
