/**
 * @fileoverview Unit tests for diagnostics handlers — get_recent_logs
 * filtering plus the get_system_health / get_health_status reports.
 */

import { describe, expect, it, vi } from 'vitest';
import type { DiagnosticsClient } from '../../../diagnostics/client.js';
import type { LogEntry, SystemHealth } from '../../../diagnostics/types.js';
import { SystemHealthSchema } from '../../../diagnostics/types.js';
import type { FoundryClient } from '../../../foundry/client.js';
import {
  handleGetHealthStatus,
  handleGetRecentLogs,
  handleGetSystemHealth,
} from '../diagnostics.js';

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

// ============================================================================
// System health handlers (#216)
//
// `SystemHealthSchema.parse()` strips unknown keys, so the fixtures below are
// deliberately run through the real schema: anything the handlers read must be
// a field the schema actually declares, or it will be `undefined` here just as
// it is in production.
// ============================================================================

function makeHealth(overrides: Record<string, unknown> = {}): SystemHealth {
  return SystemHealthSchema.parse({
    timestamp: '2024-06-01T12:00:00.000Z',
    server: {
      foundryVersion: '12.331',
      systemVersion: 'dnd5e 3.3.1',
      worldId: 'test-world',
      uptime: 7320, // 2h 2m
    },
    users: { total: 5, active: 3, gm: 1 },
    modules: { total: 50, active: 35 },
    performance: {
      memory: {
        rss: 209_715_200, // 200 MB
        heapTotal: 67_108_864, // 64 MB
        heapUsed: 47_185_920, // 45 MB
        external: 1_048_576,
        arrayBuffers: 524_288,
      },
      connectedClients: 3,
    },
    logs: { bufferSize: 500, recentErrors: 2, recentWarnings: 5, errorRate: 0.1 },
    status: 'healthy',
    ...overrides,
  });
}

function healthClient(health: SystemHealth): DiagnosticsClient {
  return {
    getSystemHealth: vi.fn().mockResolvedValue(health),
  } as unknown as DiagnosticsClient;
}

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]?.text ?? '';
}

describe('handleGetSystemHealth', () => {
  it('renders the nested values the schema actually defines', async () => {
    const text = getText(await handleGetSystemHealth({}, healthClient(makeHealth())));

    expect(text).toContain('**Overall Status:** healthy');
    expect(text).toContain('**Reported At:** 2024-06-01T12:00:00.000Z');
    // server.*
    expect(text).toContain('12.331');
    expect(text).toContain('dnd5e 3.3.1');
    expect(text).toContain('test-world');
    expect(text).toContain('**Uptime:** 2h 2m');
    // users.* / modules.*
    expect(text).toContain('3 active / 5 total');
    expect(text).toContain('1 GM');
    expect(text).toContain('35 active / 50 installed');
    // performance.*
    expect(text).toContain('**Connected Clients:** 3');
    expect(text).toContain('45 MB used / 64 MB total');
    expect(text).toContain('200 MB');
    // logs.*
    expect(text).toContain('**Recent Errors:** 2');
    expect(text).toContain('**Recent Warnings:** 5');
    expect(text).toContain('**Buffer:** 500 entries');
    expect(text).toContain('**Error Rate:** 0.1%');
  });

  it('renders no "N/A" placeholders for a fully populated payload', async () => {
    const text = getText(await handleGetSystemHealth({}, healthClient(makeHealth())));
    expect(text).not.toContain('N/A');
  });

  it('drops metrics the diagnostics schema has no field for', async () => {
    const text = getText(await handleGetSystemHealth({}, healthClient(makeHealth())));

    // No CPU/disk/throughput/response-time field exists anywhere in SystemHealthSchema
    expect(text).not.toMatch(/CPU/i);
    expect(text).not.toMatch(/Disk/i);
    expect(text).not.toMatch(/Throughput/i);
    expect(text).not.toMatch(/Response Time/i);
  });

  it('omits optional server uptime rather than printing a placeholder', async () => {
    const health = makeHealth({
      server: { foundryVersion: '12.331', systemVersion: 'dnd5e 3.3.1', worldId: 'test-world' },
    });

    const text = getText(await handleGetSystemHealth({}, healthClient(health)));

    expect(text).not.toContain('**Uptime:**');
    expect(text).not.toContain('N/A');
    expect(text).toContain('**Overall Status:** healthy');
  });

  it('omits memory lines when performance.memory is absent', async () => {
    const health = makeHealth({ performance: { connectedClients: 7 } });

    const text = getText(await handleGetSystemHealth({}, healthClient(health)));

    expect(text).toContain('**Connected Clients:** 7');
    expect(text).not.toContain('MB');
    expect(text).not.toContain('N/A');
  });

  it('reports a critical status verbatim', async () => {
    const text = getText(
      await handleGetSystemHealth({}, healthClient(makeHealth({ status: 'critical' }))),
    );
    expect(text).toContain('**Overall Status:** critical');
  });
});

describe('handleGetHealthStatus', () => {
  function worldClient(connected: boolean, stale = false): FoundryClient {
    return {
      isConnected: () => connected,
      isWorldDataStale: () => stale,
      getWorldInfo: vi.fn().mockResolvedValue({
        id: 'test-world',
        title: 'Test World',
        description: '',
        system: 'dnd5e',
        coreVersion: '12.331',
        systemVersion: '3.3.1',
        playtime: 0,
        created: '2024-01-01T00:00:00.000Z',
        modified: '2024-06-01T00:00:00.000Z',
      }),
    } as unknown as FoundryClient;
  }

  it('renders real world and system-health values, not placeholders', async () => {
    const text = getText(
      await handleGetHealthStatus({}, worldClient(true), healthClient(makeHealth())),
    );

    expect(text).toContain('✅ Connected');
    expect(text).toContain('**Title:** Test World');
    expect(text).toContain('**System:** dnd5e');
    expect(text).toContain('**Core Version:** 12.331');
    expect(text).toContain('**Status:** healthy');
    expect(text).toContain('**Uptime:** 2h 2m');
    expect(text).toContain('3 active / 5 total');
    expect(text).toContain('45 MB');
    expect(text).toContain('**Recent Errors:** 2');
    expect(text).not.toContain('N/A');
  });

  it('drops the unbacked CPU and playtime lines', async () => {
    const text = getText(
      await handleGetHealthStatus({}, worldClient(true), healthClient(makeHealth())),
    );

    expect(text).not.toMatch(/CPU/i);
    expect(text).not.toMatch(/Playtime/i);
  });

  it('degrades gracefully when system health is unavailable', async () => {
    const failing = {
      getSystemHealth: vi.fn().mockRejectedValue(new Error('no REST module')),
    } as unknown as DiagnosticsClient;

    const text = getText(await handleGetHealthStatus({}, worldClient(false), failing));

    expect(text).toContain('❌ Disconnected');
    expect(text).toContain('**Title:** Test World');
    expect(text).toContain('ℹ️ Not available');
  });

  it('degrades gracefully when world info is unavailable', async () => {
    const failingWorld = {
      isConnected: () => false,
      isWorldDataStale: () => false,
      getWorldInfo: vi.fn().mockRejectedValue(new Error('not connected')),
    } as unknown as FoundryClient;

    const text = getText(await handleGetHealthStatus({}, failingWorld, healthClient(makeHealth())));

    expect(text).toContain('ℹ️ Not available');
    expect(text).toContain('**Status:** healthy');
  });

  /**
   * #217's second impact bullet: after the socket drops, reads keep being
   * served from the cache. Rendering that snapshot with no marker presents a
   * point-in-time copy as though it were live — and after an automatic
   * reconnect the connection line reads "✅ Connected" again while the cache is
   * still missing every broadcast from the outage.
   */
  it('marks the world section stale when the cache is no longer being kept live', async () => {
    const text = getText(
      await handleGetHealthStatus({}, worldClient(true, true), healthClient(makeHealth())),
    );

    expect(text).toMatch(/stale/i);
    expect(text).toContain('refresh_world_data');
    // Still rendered — a flagged answer beats no answer.
    expect(text).toContain('**Title:** Test World');
  });

  it('leaves the world section unmarked while the cache is live', async () => {
    const text = getText(
      await handleGetHealthStatus({}, worldClient(true), healthClient(makeHealth())),
    );

    expect(text).not.toMatch(/stale/i);
    expect(text).not.toContain('refresh_world_data');
  });
});
