import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import type { FoundryClient } from '../../../foundry/client.js';
import type { CompendiumSearchResult } from '../../../foundry/types.js';
import { handleSearchCompendium } from '../compendium.js';

describe('Compendium handlers', () => {
  const divineSmite2014: CompendiumSearchResult = {
    results: [
      {
        compendiumId: 'dnd5e.spells',
        itemId: 'abcdef0123456789',
        name: 'Divine Smite',
        type: 'spell',
        img: 'icons/svg/aura.svg',
        system: { level: 1, school: 'evo', source: { rules: '2014' } },
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
    restAvailable: true,
    nextCursor: null,
  };

  const createMockClient = (result: CompendiumSearchResult = divineSmite2014): FoundryClient => {
    return {
      searchCompendium: vi.fn(() => result),
    } as unknown as FoundryClient;
  };

  describe('handleSearchCompendium', () => {
    it('returns compendium entries with disambiguating metadata', async () => {
      const mockClient = createMockClient();
      const result = await handleSearchCompendium({ query: 'Divine Smite', limit: 20 }, mockClient);

      const text = result.content[0].text;
      expect(result.content[0].type).toBe('text');
      expect(text).toContain('Compendium Search Results');
      expect(text).toContain('Divine Smite');
      // compendiumId and itemId must be present to disambiguate
      expect(text).toContain('dnd5e.spells');
      expect(text).toContain('abcdef0123456789');
      // rule revision distinguishes PHB-2014 vs PHB-2024
      expect(text).toContain('rules: 2014');
    });

    it('uses default limit of 20 when not specified', async () => {
      const mockClient = createMockClient();
      const result = await handleSearchCompendium({ query: 'Fireball' }, mockClient);

      expect(result.content[0].text).toContain('**Limit:** 20');
    });

    it('passes filters through to the client', async () => {
      const mockClient = createMockClient();
      await handleSearchCompendium(
        { query: 'Divine Smite', filters: { compendiumId: 'dnd5e.spells', spellLevel: 1 } },
        mockClient,
      );

      expect(mockClient.searchCompendium).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'Divine Smite',
          compendiumId: 'dnd5e.spells',
          spellLevel: 1,
        }),
      );
    });

    it('surfaces a REST-required note on graceful empty', async () => {
      const mockClient = createMockClient({
        results: [],
        total: 0,
        page: 1,
        limit: 20,
        restAvailable: false,
        nextCursor: null,
      });
      const result = await handleSearchCompendium({ query: 'Divine Smite' }, mockClient);

      const text = result.content[0].text;
      expect(text).toContain('No compendium entries found');
      expect(text).toContain('requires FOUNDRY_API_KEY');
    });

    it('surfaces the next-page cursor when more results remain', async () => {
      const mockClient = createMockClient({
        ...divineSmite2014,
        total: 40,
        nextCursor: 'MjA=', // base64 of offset 20
      });
      const result = await handleSearchCompendium({ query: 'Divine Smite', limit: 20 }, mockClient);

      const text = result.content[0].text;
      expect(text).toContain('Next page');
      expect(text).toContain('MjA=');
    });

    it('passes a pagination cursor through to the client', async () => {
      const mockClient = createMockClient();
      await handleSearchCompendium({ query: 'Divine Smite', cursor: 'MjA=' }, mockClient);

      expect(mockClient.searchCompendium).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'Divine Smite', cursor: 'MjA=' }),
      );
    });

    it('rejects with InvalidParams on missing query', async () => {
      const mockClient = createMockClient();
      await expect(handleSearchCompendium({ query: '' }, mockClient)).rejects.toThrow(McpError);
    });

    it('rejects with InvalidParams on non-string query', async () => {
      const mockClient = createMockClient();
      await expect(
        handleSearchCompendium({ query: 123 as unknown as string }, mockClient),
      ).rejects.toThrow(McpError);
    });

    it('propagates client errors through withToolError', async () => {
      const mockClient = {
        searchCompendium: vi.fn(() => {
          throw new Error('Compendium pack not found');
        }),
      } as unknown as FoundryClient;

      await expect(handleSearchCompendium({ query: 'Divine Smite' }, mockClient)).rejects.toThrow();
    });
  });
});
