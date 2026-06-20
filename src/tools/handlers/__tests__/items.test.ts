/**
 * @fileoverview Unit tests for items handler — search_items formatting and filters
 */

import { describe, expect, it, vi } from 'vitest';
import type { FoundryClient } from '../../../foundry/client.js';
import { handleSearchItems } from '../items.js';

interface MockItem {
  _id: string;
  name: string;
  type: string;
  rarity?: string;
  price?: { value: number; denomination: string };
}

interface MockSearchParams {
  query: string;
  type?: string;
  rarity?: string;
  limit: number;
}

function mockFoundryClient(result: {
  items: MockItem[];
  total: number;
  page: number;
  limit: number;
}): { client: FoundryClient; calls: { params: MockSearchParams[] } } {
  const calls = { params: [] as MockSearchParams[] };
  const client = {
    searchItems: vi.fn(async (params: MockSearchParams) => {
      calls.params.push(params);
      return result;
    }),
  } as unknown as FoundryClient;
  return { client, calls };
}

function getText(result: Awaited<ReturnType<typeof handleSearchItems>>): string {
  return (result as { content: Array<{ type: string; text: string }> }).content[0]?.text ?? '';
}

describe('handleSearchItems', () => {
  describe('happy path', () => {
    it('formats item results with name, type, rarity, and price', async () => {
      const { client, calls } = mockFoundryClient({
        items: [
          {
            _id: 'item-1',
            name: 'Longsword',
            type: 'weapon',
            rarity: 'Common',
            price: { value: 15, denomination: 'gp' },
          },
          {
            _id: 'item-2',
            name: 'Potion of Healing',
            type: 'consumable',
            rarity: 'Common',
            price: { value: 50, denomination: 'gp' },
          },
        ],
        total: 2,
        page: 1,
        limit: 10,
      });

      const result = await handleSearchItems(
        { query: 'sword', type: 'weapon', rarity: 'Common' },
        client,
      );
      const text = getText(result);

      expect(text).toContain('Item Search Results');
      expect(text).toContain('**Query:** sword');
      expect(text).toContain('**Type Filter:** weapon');
      expect(text).toContain('**Rarity Filter:** Common');
      expect(text).toContain('**Results:** 2/2 total');
      expect(text).toContain('**Longsword** (weapon) - Common - 15 gp');
      expect(text).toContain('**Potion of Healing** (consumable) - Common - 50 gp');
      expect(text).toContain('**Page:** 1 | **Limit:** 10');

      // Verify filters were forwarded
      expect(calls.params).toHaveLength(1);
      expect(calls.params[0]).toMatchObject({
        query: 'sword',
        type: 'weapon',
        rarity: 'Common',
        limit: 10,
      });
    });

    it('defaults query/type/rarity labels when none supplied and uses default limit 10', async () => {
      const { client, calls } = mockFoundryClient({
        items: [],
        total: 0,
        page: 1,
        limit: 10,
      });

      const result = await handleSearchItems({}, client);
      const text = getText(result);

      expect(text).toContain('**Query:** All items');
      expect(text).toContain('**Type Filter:** All types');
      expect(text).toContain('**Rarity Filter:** All rarities');
      // Filters should not be passed when undefined
      expect(calls.params[0]).toEqual({ query: '', limit: 10 });
    });
  });

  describe('edge cases', () => {
    it('renders "No items found" placeholder for empty result set', async () => {
      const { client } = mockFoundryClient({
        items: [],
        total: 0,
        page: 1,
        limit: 10,
      });

      const result = await handleSearchItems({ query: 'xyzzy' }, client);
      const text = getText(result);

      expect(text).toContain('No items found matching the criteria.');
    });

    it('falls back to "Common" rarity and "Unknown price" when item fields are missing', async () => {
      const { client } = mockFoundryClient({
        items: [
          {
            _id: 'item-3',
            name: 'Mystery Box',
            type: 'misc',
            // no rarity, no price
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      });

      const result = await handleSearchItems({ query: 'box' }, client);
      const text = getText(result);

      expect(text).toContain('**Mystery Box** (misc) - Common - Unknown price');
    });
  });
});
