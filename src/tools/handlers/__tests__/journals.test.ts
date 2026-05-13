/**
 * @fileoverview Unit tests for journals handlers — search_journals and get_journal
 */

import { describe, expect, it, vi } from 'vitest';
import type { FoundryClient } from '../../../foundry/client.js';
import { handleGetJournal, handleSearchJournals } from '../journals.js';

interface MockJournal {
  _id: string;
  name: string;
  pages?: Array<{
    _id: string;
    name: string;
    type: string;
    text?: { content: string; format: number };
  }>;
}

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]?.text ?? '';
}

function makeJournal(id: string, name: string, pageCount: number): MockJournal {
  return {
    _id: id,
    name,
    pages: Array.from({ length: pageCount }, (_, i) => ({
      _id: `${id}-page-${i}`,
      name: `Page ${i + 1}`,
      type: 'text',
      text: { content: `<p>Page ${i + 1} content for ${name}.</p>`, format: 1 },
    })),
  };
}

describe('handleSearchJournals', () => {
  describe('happy path', () => {
    it('formats matching journals with page count and ID', async () => {
      const journals: MockJournal[] = [
        makeJournal('jrnl-1', 'Adventure Log', 5),
        makeJournal('jrnl-2', 'Lore Compendium', 1),
        makeJournal('jrnl-3', 'Empty Journal', 0),
      ];
      const client = {
        searchJournals: vi.fn((_q: string) => journals),
      } as unknown as FoundryClient;

      const result = await handleSearchJournals({ query: 'adventure' }, client);
      const text = getText(result);

      expect(text).toContain('Journal Search');
      expect(text).toContain('"adventure"');
      expect(text).toContain('(3 results)');
      expect(text).toContain('**Adventure Log** (5 pages)');
      expect(text).toContain('**Lore Compendium** (1 page)');
      expect(text).toContain('**Empty Journal** (0 pages)');
      expect(text).toContain('ID: jrnl-1');
      expect(text).toContain('ID: jrnl-2');
      expect(client.searchJournals).toHaveBeenCalledWith('adventure');
    });

    it('honors a caller-supplied limit', async () => {
      const journals: MockJournal[] = Array.from({ length: 25 }, (_, i) =>
        makeJournal(`jrnl-${i}`, `Journal ${i}`, 1),
      );
      const client = {
        searchJournals: vi.fn(() => journals),
      } as unknown as FoundryClient;

      const result = await handleSearchJournals({ query: 'j', limit: 5 }, client);
      const text = getText(result);

      // Total count still reflects the full result set
      expect(text).toContain('(25 results)');
      // But only the first 5 entries are listed
      expect(text).toContain('**Journal 0**');
      expect(text).toContain('**Journal 4**');
      expect(text).not.toContain('**Journal 5**');
    });
  });

  describe('edge cases', () => {
    it('returns "No journals found" placeholder when search returns empty', async () => {
      const client = {
        searchJournals: vi.fn(() => []),
      } as unknown as FoundryClient;

      const result = await handleSearchJournals({ query: 'xyzzy' }, client);
      const text = getText(result);

      expect(text).toContain('No journals found matching "xyzzy".');
    });
  });
});

describe('handleGetJournal', () => {
  describe('happy path', () => {
    it('returns journal with HTML-stripped page content', async () => {
      const journal: MockJournal = {
        _id: 'jrnl-1',
        name: 'Test Journal',
        pages: [
          {
            _id: 'p-1',
            name: 'Introduction',
            type: 'text',
            text: { content: '<p>Hello <b>world</b>.</p>', format: 1 },
          },
        ],
      };
      const client = {
        getJournal: vi.fn((_id: string) => journal),
      } as unknown as FoundryClient;

      const result = await handleGetJournal({ journalId: 'jrnl-1' }, client);
      const text = getText(result);

      expect(text).toContain('**Journal: Test Journal**');
      expect(text).toContain('ID: jrnl-1');
      expect(text).toContain('### Introduction');
      expect(text).toContain('Hello world.');
      // HTML tags should have been stripped
      expect(text).not.toContain('<p>');
      expect(text).not.toContain('<b>');
      expect(client.getJournal).toHaveBeenCalledWith('jrnl-1');
    });

    it('falls back to "No pages." when journal has no pages', async () => {
      const journal: MockJournal = { _id: 'jrnl-2', name: 'Empty', pages: [] };
      const client = {
        getJournal: vi.fn(() => journal),
      } as unknown as FoundryClient;

      const result = await handleGetJournal({ journalId: 'jrnl-2' }, client);
      const text = getText(result);

      expect(text).toContain('**Journal: Empty**');
      expect(text).toContain('No pages.');
    });
  });

  describe('edge cases', () => {
    it('throws McpError when journal not found', async () => {
      const client = {
        getJournal: vi.fn(() => undefined),
      } as unknown as FoundryClient;

      await expect(handleGetJournal({ journalId: 'missing' }, client)).rejects.toThrow(
        /Journal not found: missing/,
      );
    });

    it('truncates page content longer than 500 chars with ellipsis', async () => {
      const longText = 'a'.repeat(600);
      const journal: MockJournal = {
        _id: 'jrnl-3',
        name: 'Long',
        pages: [
          {
            _id: 'p-1',
            name: 'Big Page',
            type: 'text',
            text: { content: longText, format: 1 },
          },
        ],
      };
      const client = {
        getJournal: vi.fn(() => journal),
      } as unknown as FoundryClient;

      const result = await handleGetJournal({ journalId: 'jrnl-3' }, client);
      const text = getText(result);

      expect(text).toContain('### Big Page');
      expect(text).toContain('...');
      // The 500-char slice should be present but the full 600-char string should not
      expect(text).not.toContain('a'.repeat(600));
    });
  });
});
