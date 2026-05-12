/**
 * @fileoverview Unit tests for diagnostics handler — get_recent_logs filtering
 */

import { describe, expect, it, vi } from 'vitest';
import type { DiagnosticsClient } from '../../../diagnostics/client.js';
import type { LogEntry } from '../../../diagnostics/types.js';
import { handleGetRecentLogs } from '../diagnostics.js';

// Minimal LogEntry factory
function makeEntry(
  level: LogEntry['level'],
  timestamp: string,
  message = 'test message',
): LogEntry {
  return { timestamp, level, message, source: 'foundry' };
}

// Build a mock DiagnosticsClient that returns a fixed log list
function mockClient(logs: LogEntry[]): DiagnosticsClient {
  return {
    getRecentLogs: vi.fn().mockResolvedValue({ logs, total: logs.length }),
  } as unknown as DiagnosticsClient;
}

// Extract log lines from the MCP response text
function extractLines(result: Awaited<ReturnType<typeof handleGetRecentLogs>>): string[] {
  const text =
    (result as { content: Array<{ type: string; text: string }> }).content[0]?.text ?? '';
  // Lines after the header block (the blank line following "Since:")
  const body = text.split('\n\n').slice(1).join('\n\n').trim();
  return body === 'No log entries found.' ? [] : body.split('\n').filter(Boolean);
}

const now = new Date('2024-06-01T12:00:00.000Z').getTime();

// Sample dataset — 10 entries spanning different levels and times
const SAMPLE_LOGS: LogEntry[] = [
  makeEntry('error', new Date(now - 9000).toISOString(), 'error msg 1'),
  makeEntry('warn', new Date(now - 8000).toISOString(), 'warn msg 1'),
  makeEntry('info', new Date(now - 7000).toISOString(), 'info msg 1'),
  makeEntry('log', new Date(now - 6000).toISOString(), 'log msg 1'),
  makeEntry('error', new Date(now - 5000).toISOString(), 'error msg 2'),
  makeEntry('warn', new Date(now - 4000).toISOString(), 'warn msg 2'),
  makeEntry('info', new Date(now - 3000).toISOString(), 'info msg 2'),
  makeEntry('error', new Date(now - 2000).toISOString(), 'error msg 3'),
  makeEntry('info', new Date(now - 1000).toISOString(), 'info msg 3'),
  makeEntry('warn', new Date(now - 500).toISOString(), 'warn msg 3'),
];

describe('handleGetRecentLogs', () => {
  describe('default behavior (no filters)', () => {
    it('returns all entries when no args supplied', async () => {
      const client = mockClient(SAMPLE_LOGS);
      const result = await handleGetRecentLogs({}, client);
      const lines = extractLines(result);
      expect(lines).toHaveLength(SAMPLE_LOGS.length);
    });
  });

  describe('limit', () => {
    it('slices to the requested limit', async () => {
      const client = mockClient(SAMPLE_LOGS);
      const result = await handleGetRecentLogs({ limit: 3 }, client);
      const lines = extractLines(result);
      expect(lines).toHaveLength(3);
    });

    it('returns all entries when limit exceeds dataset size', async () => {
      const client = mockClient(SAMPLE_LOGS);
      const result = await handleGetRecentLogs({ limit: 500 }, client);
      const lines = extractLines(result);
      expect(lines).toHaveLength(SAMPLE_LOGS.length);
    });

    it('clamps to hard upper bound of 1000', async () => {
      // Build 1100 entries
      const bigLogs = Array.from({ length: 1100 }, (_, i) =>
        makeEntry('info', new Date(now + i * 1000).toISOString(), `msg ${i}`),
      );
      const client = mockClient(bigLogs);
      const result = await handleGetRecentLogs({ limit: 9999 }, client);
      const lines = extractLines(result);
      expect(lines).toHaveLength(1000);
    });
  });

  describe('level filter', () => {
    it('returns only error entries when level is "error"', async () => {
      const client = mockClient(SAMPLE_LOGS);
      const result = await handleGetRecentLogs({ level: 'error' }, client);
      const lines = extractLines(result);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toMatch(/\*\*ERROR\*\*/);
      }
    });

    it('returns only warn entries when level is "warn"', async () => {
      const client = mockClient(SAMPLE_LOGS);
      const result = await handleGetRecentLogs({ level: 'warn' }, client);
      const lines = extractLines(result);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toMatch(/\*\*WARN\*\*/);
      }
    });

    it('handles level as array, returning only matching entries', async () => {
      const client = mockClient(SAMPLE_LOGS);
      const result = await handleGetRecentLogs({ level: ['error', 'warn'] }, client);
      const lines = extractLines(result);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toMatch(/\*\*(ERROR|WARN)\*\*/);
      }
    });

    it('ignores unrecognized level and returns all entries', async () => {
      const client = mockClient(SAMPLE_LOGS);
      const result = await handleGetRecentLogs({ level: 'bogus' }, client);
      const lines = extractLines(result);
      // unrecognized level → no filter applied → all entries returned (up to default limit 20)
      expect(lines).toHaveLength(SAMPLE_LOGS.length);
    });

    it('does not throw when level is unrecognized', async () => {
      const client = mockClient(SAMPLE_LOGS);
      await expect(handleGetRecentLogs({ level: 'INVALID_LEVEL' }, client)).resolves.toBeDefined();
    });
  });

  describe('since filter', () => {
    it('returns empty array when since is a future timestamp', async () => {
      const futureTimestamp = new Date(now + 99_999_000).toISOString();
      const client = mockClient(SAMPLE_LOGS);
      const result = await handleGetRecentLogs({ since: futureTimestamp }, client);
      const lines = extractLines(result);
      expect(lines).toHaveLength(0);
    });

    it('returns only entries at or after the since timestamp', async () => {
      // Only the last 3 entries are within -3000ms of now
      const sinceTimestamp = new Date(now - 3000).toISOString();
      const client = mockClient(SAMPLE_LOGS);
      const result = await handleGetRecentLogs({ since: sinceTimestamp }, client);
      const lines = extractLines(result);
      // entries at -3000, -2000, -1000, -500 should pass (timestamp >= since)
      expect(lines.length).toBeGreaterThanOrEqual(1);
      // none of the earlier entries should appear
      for (const line of lines) {
        const match = line.match(/\[([^\]]+)\]/);
        if (match?.[1]) {
          const entryMs = Date.parse(match[1]);
          expect(entryMs).toBeGreaterThanOrEqual(Date.parse(sinceTimestamp));
        }
      }
    });

    it('ignores unparseable since and returns all entries', async () => {
      const client = mockClient(SAMPLE_LOGS);
      const result = await handleGetRecentLogs({ since: 'not-a-date' }, client);
      const lines = extractLines(result);
      expect(lines).toHaveLength(SAMPLE_LOGS.length);
    });

    it('does not throw when since is unparseable', async () => {
      const client = mockClient(SAMPLE_LOGS);
      await expect(handleGetRecentLogs({ since: '!!invalid!!' }, client)).resolves.toBeDefined();
    });
  });

  describe('combined filters', () => {
    it('applies level and limit together', async () => {
      const client = mockClient(SAMPLE_LOGS);
      const result = await handleGetRecentLogs({ level: 'error', limit: 2 }, client);
      const lines = extractLines(result);
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line).toMatch(/\*\*ERROR\*\*/);
      }
    });

    it('applies since and level together', async () => {
      // Only errors at or after -5000ms
      const sinceTimestamp = new Date(now - 5000).toISOString();
      const client = mockClient(SAMPLE_LOGS);
      const result = await handleGetRecentLogs({ level: 'error', since: sinceTimestamp }, client);
      const lines = extractLines(result);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toMatch(/\*\*ERROR\*\*/);
      }
    });
  });

  describe('empty source', () => {
    it('returns "No log entries found." when source has no logs', async () => {
      const client = mockClient([]);
      const result = await handleGetRecentLogs({}, client);
      const text =
        (result as { content: Array<{ type: string; text: string }> }).content[0]?.text ?? '';
      expect(text).toContain('No log entries found.');
    });
  });
});
