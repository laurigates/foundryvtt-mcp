/**
 * @fileoverview Unit tests for diagnostics handler — handleSearchLogs
 *
 * Lives in a separate test file from diagnostics.test.ts to keep
 * the existing get_recent_logs coverage untouched.
 *
 * `DiagnosticsClient.searchLogs()` resolves to a `LogSearchResponse` **object**
 * (`{ logs, matches, pattern, searchTimeframe }`), validated by
 * `LogSearchResponseSchema`. These tests mock that real shape — never a bare
 * array — so the handler is exercised against what the client actually returns.
 */

import { describe, expect, it, vi } from 'vitest';
import type { DiagnosticsClient } from '../../../diagnostics/client.js';
import type { LogEntry, LogSearchResponse } from '../../../diagnostics/types.js';
import { LogSearchResponseSchema } from '../../../diagnostics/types.js';
import { handleSearchLogs } from '../diagnostics.js';

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]?.text ?? '';
}

function makeEntry(
  level: LogEntry['level'],
  timestamp: string,
  message: string,
  source: LogEntry['source'] = 'foundry',
): LogEntry {
  return { timestamp, level, message, source };
}

/**
 * Build a mock client whose `searchLogs` resolves to a *schema-validated*
 * `LogSearchResponse`, so the fixtures cannot drift from the real contract.
 */
function mockClient(
  response: Partial<LogSearchResponse> & { logs: LogEntry[] },
): DiagnosticsClient {
  const parsed = LogSearchResponseSchema.parse({
    logs: response.logs,
    matches: response.matches ?? response.logs.length,
    pattern: response.pattern ?? 'pattern',
    searchTimeframe: response.searchTimeframe ?? 'all',
  });

  return {
    searchLogs: vi.fn().mockResolvedValue(parsed),
  } as unknown as DiagnosticsClient;
}

const SAMPLE_ENTRIES: LogEntry[] = [
  makeEntry('error', '2024-06-01T12:00:00.000Z', 'database connection failed', 'foundry'),
  makeEntry('warn', '2024-06-01T12:00:01.000Z', 'retry attempt 1', 'module'),
  makeEntry('info', '2024-06-01T12:00:02.000Z', 'database reconnected', 'foundry'),
];

describe('handleSearchLogs', () => {
  describe('rendering the response body', () => {
    it('renders the entries carried in the response object (not a bare array)', async () => {
      const client = mockClient({ logs: SAMPLE_ENTRIES, matches: 3, pattern: 'database' });

      const text = getText(await handleSearchLogs({ query: 'database' }, client));

      expect(text).toContain('Log Search Results');
      expect(text).toContain('[2024-06-01T12:00:00.000Z] **ERROR** database connection failed');
      expect(text).toContain('[2024-06-01T12:00:01.000Z] **WARN** retry attempt 1');
      expect(text).toContain('[2024-06-01T12:00:02.000Z] **INFO** database reconnected');
      expect(text).not.toContain('No logs available');
      expect(text).not.toContain('No matching log entries found.');
    });

    it('reports the response `matches` count rather than 0', async () => {
      const client = mockClient({ logs: SAMPLE_ENTRIES, matches: 42 });

      const text = getText(await handleSearchLogs({ query: 'database' }, client));

      expect(text).toContain('**Matches:** 42');
      expect(text).toContain('**Showing:** 3');
    });

    it('echoes the query and the searched timeframe', async () => {
      const client = mockClient({ logs: SAMPLE_ENTRIES, searchTimeframe: '3600' });

      const text = getText(await handleSearchLogs({ query: 'database' }, client));

      expect(text).toContain('**Query:** "database"');
      expect(text).toContain('**Timeframe:** 3600');
    });
  });

  describe('level parameter', () => {
    it('forwards a recognized level to searchLogs', async () => {
      const client = mockClient({ logs: SAMPLE_ENTRIES });

      await handleSearchLogs({ query: 'database', level: 'error' }, client);

      expect(client.searchLogs).toHaveBeenCalledWith({ pattern: 'database', level: 'error' });
    });

    it('normalizes level casing before forwarding', async () => {
      const client = mockClient({ logs: SAMPLE_ENTRIES });

      await handleSearchLogs({ query: 'database', level: 'ERROR' }, client);

      expect(client.searchLogs).toHaveBeenCalledWith({ pattern: 'database', level: 'error' });
    });

    it('omits level from the request when not supplied', async () => {
      const client = mockClient({ logs: SAMPLE_ENTRIES });

      const text = getText(await handleSearchLogs({ query: 'database' }, client));

      expect(client.searchLogs).toHaveBeenCalledWith({ pattern: 'database' });
      expect(text).toContain('**Level Filter:** All levels');
    });

    it('does not forward an unsupported level and says so in the header', async () => {
      const client = mockClient({ logs: SAMPLE_ENTRIES });

      // 'debug' is in the tool schema enum but not in the LogEntry level enum
      const text = getText(await handleSearchLogs({ query: 'database', level: 'debug' }, client));

      expect(client.searchLogs).toHaveBeenCalledWith({ pattern: 'database' });
      expect(text).toContain('**Level Filter:** debug (unsupported — not applied)');
    });

    it('reports the applied level in the header', async () => {
      const client = mockClient({ logs: SAMPLE_ENTRIES });

      const text = getText(await handleSearchLogs({ query: 'database', level: 'warn' }, client));

      expect(text).toContain('**Level Filter:** warn');
    });
  });

  describe('limit parameter', () => {
    it('truncates rendered entries to the requested limit', async () => {
      const client = mockClient({ logs: SAMPLE_ENTRIES, matches: 3 });

      const text = getText(await handleSearchLogs({ query: 'database', limit: 2 }, client));

      expect(text).toContain('database connection failed');
      expect(text).toContain('retry attempt 1');
      expect(text).not.toContain('database reconnected');
      expect(text).toContain('**Limit:** 2');
      // total matches is unchanged by the display limit
      expect(text).toContain('**Matches:** 3');
      expect(text).toContain('**Showing:** 2');
    });

    it('defaults to 50 when limit is not supplied', async () => {
      const client = mockClient({ logs: SAMPLE_ENTRIES });

      const text = getText(await handleSearchLogs({ query: 'database' }, client));

      expect(text).toContain('**Limit:** 50');
      expect(text).toContain('**Showing:** 3');
    });

    it('clamps a non-positive limit to 1', async () => {
      const client = mockClient({ logs: SAMPLE_ENTRIES });

      const text = getText(await handleSearchLogs({ query: 'database', limit: 0 }, client));

      expect(text).toContain('**Limit:** 1');
      expect(text).toContain('**Showing:** 1');
      expect(text).not.toContain('retry attempt 1');
    });

    it('clamps an oversized limit to the hard cap of 1000', async () => {
      const client = mockClient({ logs: SAMPLE_ENTRIES });

      const text = getText(await handleSearchLogs({ query: 'database', limit: 9999 }, client));

      expect(text).toContain('**Limit:** 1000');
    });
  });

  describe('edge cases', () => {
    it('reports zero results when the response carries no entries', async () => {
      const client = mockClient({ logs: [], matches: 0 });

      const text = getText(await handleSearchLogs({ query: 'xyzzy' }, client));

      expect(text).toContain('**Matches:** 0');
      expect(text).toContain('No matching log entries found.');
    });

    it('throws McpError when query is empty string', async () => {
      const client = mockClient({ logs: [] });
      await expect(handleSearchLogs({ query: '' } as { query: string }, client)).rejects.toThrow(
        /Query is required/,
      );
    });

    it('throws McpError when query is not a string', async () => {
      const client = mockClient({ logs: [] });
      await expect(
        handleSearchLogs({ query: 42 } as unknown as { query: string }, client),
      ).rejects.toThrow(/Query is required/);
    });

    it('surfaces client failures as a tool error', async () => {
      const client = {
        searchLogs: vi.fn().mockRejectedValue(new Error('Failed to search logs: boom')),
      } as unknown as DiagnosticsClient;

      await expect(handleSearchLogs({ query: 'boom' }, client)).rejects.toThrow(/search logs/);
    });
  });
});
