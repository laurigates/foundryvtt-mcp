/**
 * @fileoverview Unit tests for diagnostics handler — handleSearchLogs
 *
 * Lives in a separate test file from diagnostics.test.ts to keep
 * the existing get_recent_logs coverage untouched.
 */

import { describe, expect, it, vi } from 'vitest';
import type { DiagnosticsClient } from '../../../diagnostics/client.js';
import { handleSearchLogs } from '../diagnostics.js';

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]?.text ?? '';
}

function mockClient(logs: unknown): DiagnosticsClient {
  return {
    searchLogs: vi.fn(async (_params: { pattern: string }) => logs),
  } as unknown as DiagnosticsClient;
}

describe('handleSearchLogs', () => {
  describe('happy path', () => {
    it('formats matching log entries with timestamp, level, and message', async () => {
      const logs = [
        {
          timestamp: '2024-06-01T12:00:00.000Z',
          level: 'error',
          message: 'database connection failed',
        },
        {
          timestamp: '2024-06-01T12:00:01.000Z',
          level: 'warn',
          message: 'retry attempt 1',
        },
      ];
      const client = mockClient(logs);

      const result = await handleSearchLogs({ query: 'database', level: 'error' }, client);
      const text = getText(result);

      expect(text).toContain('Log Search Results');
      expect(text).toContain('**Query:** "database"');
      expect(text).toContain('**Level Filter:** error');
      expect(text).toContain('**Results:** 2');
      expect(text).toContain('**ERROR** database connection failed');
      expect(text).toContain('**WARN** retry attempt 1');
      expect(client.searchLogs).toHaveBeenCalledWith({ pattern: 'database' });
    });

    it('renders default "All levels" filter label when level not supplied', async () => {
      const client = mockClient([
        { timestamp: '2024-06-01T12:00:00.000Z', level: 'info', message: 'hello' },
      ]);

      const result = await handleSearchLogs({ query: 'hello' }, client);
      const text = getText(result);

      expect(text).toContain('**Level Filter:** All levels');
      expect(text).toContain('**INFO** hello');
    });
  });

  describe('edge cases', () => {
    it('returns zero results and empty body when client returns empty array', async () => {
      const client = mockClient([]);
      const result = await handleSearchLogs({ query: 'xyzzy' }, client);
      const text = getText(result);

      expect(text).toContain('**Results:** 0');
      expect(text).toContain('No matching log entries found.');
    });

    it('throws McpError when query is empty string', async () => {
      const client = mockClient([]);
      await expect(
        handleSearchLogs({ query: '' } as { query: string }, client),
      ).rejects.toThrow(/Query is required/);
    });

    it('throws McpError when query is not a string', async () => {
      const client = mockClient([]);
      await expect(
        handleSearchLogs({ query: 42 } as unknown as { query: string }, client),
      ).rejects.toThrow(/Query is required/);
    });

    it('falls back to defaults when log entries lack timestamp/level/message', async () => {
      // Use stringifiable values for the fall-through `String(log)` branch
      const logs = [{}, { message: 'partial' }];
      const client = mockClient(logs);

      const result = await handleSearchLogs({ query: 'anything' }, client);
      const text = getText(result);

      // Entries with no `level` should default to INFO; entries without timestamp get a fresh one
      expect(text).toContain('**INFO**');
      expect(text).toContain('**Results:** 2');
    });
  });
});
