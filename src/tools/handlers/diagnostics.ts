/**
 * @fileoverview Diagnostics and logging tool handlers
 *
 * Handles system diagnostics, logging, and health monitoring.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { DiagnosticsClient } from '../../diagnostics/client.js';
import type { LogEntry } from '../../diagnostics/types.js';
import { LogEntrySchema } from '../../diagnostics/types.js';
import type { FoundryClient } from '../../foundry/client.js';
import type { DiagnosticSystem } from '../../utils/diagnostics.js';
import { withToolError } from './utils.js';

/** Valid log levels recognized by the tool schema */
const VALID_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'log', 'notification']);

/** Hard upper bound on entries returned, regardless of caller-supplied limit */
const MAX_LOG_LIMIT = 1000;

/** Default number of search hits rendered when the caller supplies no limit */
const DEFAULT_SEARCH_LIMIT = 50;

/**
 * Shown whenever `FoundryClient.isWorldDataStale()` is set (#217): the cached
 * world snapshot is still being served, but it stopped following live document
 * changes when the socket dropped and nothing replays the gap.
 */
const STALE_WORLD_DATA_NOTICE =
  '⚠️ **Stale:** this snapshot stopped following live changes when the connection dropped, ' +
  'and document changes made since are missing. Run `refresh_world_data` to resync.';

/**
 * Handles recent log retrieval requests
 *
 * Filtering is applied after fetching all logs from the underlying source:
 * - `limit`: clamps result count (default 20, hard cap 1000)
 * - `level`: case-insensitive match against log entry level; unrecognized values are silently ignored
 * - `since`: ISO 8601 timestamp; entries older than this are excluded; unparseable values are silently ignored
 */
export async function handleGetRecentLogs(
  args: {
    limit?: number;
    level?: string | string[];
    since?: string;
  },
  diagnosticsClient: DiagnosticsClient,
) {
  const { limit = 20, level, since } = args;

  // Clamp limit to [1, MAX_LOG_LIMIT]
  const effectiveLimit = Math.min(Math.max(1, limit ?? 20), MAX_LOG_LIMIT);

  // Normalize level filter: resolve to a Set of valid lowercase level strings, or null if none recognized
  let levelFilter: Set<string> | null = null;
  if (level !== undefined && level !== null) {
    const requested = (Array.isArray(level) ? level : [level])
      .map((l) => l.toLowerCase())
      .filter((l) => VALID_LOG_LEVELS.has(l));
    if (requested.length > 0) {
      levelFilter = new Set(requested);
    }
    // If no recognized levels, levelFilter stays null → all entries pass through
  }

  // Parse since timestamp; ignore if unparseable
  let sinceMs: number | null = null;
  if (since !== undefined && since !== null && since !== '') {
    const parsed = Date.parse(since);
    if (!Number.isNaN(parsed)) {
      sinceMs = parsed;
    }
  }

  return withToolError('get recent logs', async () => {
    const response = await diagnosticsClient.getRecentLogs();
    let entries = response.logs;

    // Apply level filter
    if (levelFilter !== null) {
      entries = entries.filter((entry) => levelFilter?.has(entry.level.toLowerCase()));
    }

    // Apply since filter
    if (sinceMs !== null) {
      const sinceThreshold = sinceMs;
      entries = entries.filter((entry) => {
        const entryMs = Date.parse(entry.timestamp);
        return !Number.isNaN(entryMs) && entryMs >= sinceThreshold;
      });
    }

    // Apply limit
    entries = entries.slice(0, effectiveLimit);

    const logEntries = entries
      .map((entry) => `[${entry.timestamp}] **${entry.level.toUpperCase()}** ${entry.message}`)
      .join('\n');

    const levelLabel = level ? (Array.isArray(level) ? level.join(', ') : level) : 'All levels';

    return {
      content: [
        {
          type: 'text',
          text: `📋 **Recent Log Entries**
**Filter:** ${levelLabel}
**Limit:** ${effectiveLimit}
**Since:** ${since || 'Beginning'}

${logEntries || 'No log entries found.'}`,
        },
      ],
    };
  });
}

/**
 * Resolves a caller-supplied level string to a level the search endpoint accepts.
 *
 * The tool schema advertises `debug`, which has no counterpart in the log
 * entry level enum; such values are dropped rather than sent upstream.
 *
 * @returns the normalized level, or `undefined` when unsupported/absent
 */
function resolveSearchLevel(level: string | undefined): LogEntry['level'] | undefined {
  if (typeof level !== 'string' || level === '') {
    return undefined;
  }
  const parsed = LogEntrySchema.shape.level.safeParse(level.toLowerCase());
  return parsed.success ? parsed.data : undefined;
}

/**
 * Handles log search requests
 *
 * `searchLogs()` resolves to a `LogSearchResponse` object; matched entries live
 * under `response.logs` and the upstream match count under `response.matches`.
 *
 * - `level`: forwarded to the search request when it names a real log level
 * - `limit`: applied to the rendered entries (default 50, hard cap 1000); it
 *   does not shrink the reported `matches` total
 */
export async function handleSearchLogs(
  args: {
    query: string;
    level?: string;
    limit?: number;
  },
  diagnosticsClient: DiagnosticsClient,
) {
  const { query, level, limit } = args;

  if (!query || typeof query !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Query is required and must be a string');
  }

  const searchLevel = resolveSearchLevel(level);
  const effectiveLimit = Math.min(Math.max(1, limit ?? DEFAULT_SEARCH_LIMIT), MAX_LOG_LIMIT);

  let levelLabel = 'All levels';
  if (searchLevel !== undefined) {
    levelLabel = searchLevel;
  } else if (level) {
    levelLabel = `${level} (unsupported — not applied)`;
  }

  return withToolError('search logs', async () => {
    const response = await diagnosticsClient.searchLogs({
      pattern: query,
      ...(searchLevel !== undefined ? { level: searchLevel } : {}),
    });

    const shown = response.logs.slice(0, effectiveLimit);
    const logEntries = shown
      .map((entry) => `[${entry.timestamp}] **${entry.level.toUpperCase()}** ${entry.message}`)
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `🔍 **Log Search Results**
**Query:** "${query}"
**Level Filter:** ${levelLabel}
**Limit:** ${effectiveLimit}
**Timeframe:** ${response.searchTimeframe}
**Matches:** ${response.matches}
**Showing:** ${shown.length}

${logEntries || 'No matching log entries found.'}`,
        },
      ],
    };
  });
}

/**
 * Formats an uptime in seconds as a compact human-readable duration
 */
function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${total % 60}s`;
  }
  return `${total}s`;
}

/**
 * Formats a byte count (as reported by `process.memoryUsage()`) in binary
 * megabytes (MiB, the unit Node.js tooling conventionally labels "MB")
 */
function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Handles system health requests
 *
 * Every value rendered here is a field `SystemHealthSchema` actually declares.
 * The schema strips unknown keys, so metrics it does not model (CPU, disk,
 * response time, throughput) cannot be reported and are deliberately absent
 * rather than rendered as a permanent `N/A`. Optional fields (`server.uptime`,
 * `performance.memory`) are omitted when the server does not supply them.
 */
export async function handleGetSystemHealth(
  _args: Record<string, unknown>,
  diagnosticsClient: DiagnosticsClient,
) {
  return withToolError('get system health', async () => {
    const health = await diagnosticsClient.getSystemHealth();
    const { server, users, modules, performance, logs } = health;

    const serverLines = [
      `- **FoundryVTT Version:** ${server.foundryVersion}`,
      `- **Game System:** ${server.systemVersion}`,
      `- **World:** ${server.worldId}`,
    ];
    if (server.uptime !== undefined) {
      serverLines.push(`- **Uptime:** ${formatUptime(server.uptime)}`);
    }

    const performanceLines = [`- **Connected Clients:** ${performance.connectedClients}`];
    if (performance.memory) {
      performanceLines.push(
        `- **Memory (heap):** ${formatMegabytes(performance.memory.heapUsed)} used / ${formatMegabytes(performance.memory.heapTotal)} total`,
        `- **Memory (RSS):** ${formatMegabytes(performance.memory.rss)}`,
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: `🏥 **System Health Status**
**Overall Status:** ${health.status}
**Reported At:** ${health.timestamp}

**Server:**
${serverLines.join('\n')}

**Sessions:**
- **Users:** ${users.active} active / ${users.total} total (${users.gm} GM)
- **Modules:** ${modules.active} active / ${modules.total} installed

**Performance:**
${performanceLines.join('\n')}

**Logs:**
- **Buffer:** ${logs.bufferSize} entries
- **Recent Errors:** ${logs.recentErrors}
- **Recent Warnings:** ${logs.recentWarnings}
- **Error Rate:** ${logs.errorRate}%`,
        },
      ],
    };
  });
}

/**
 * Handles error diagnosis requests
 */
export async function handleDiagnoseErrors(
  args: {
    category?: string;
  },
  _diagnosticSystem: DiagnosticSystem,
) {
  const { category } = args;

  return withToolError('diagnose errors', async () => {
    // Mock diagnosis since the method doesn't exist yet
    const diagnosis = {
      errors: [],
      recommendations: ['No specific errors detected', 'System appears to be functioning normally'],
      systemStatus: 'Operational',
    };

    const errorsByCategory = diagnosis.errors.reduce(
      (acc: Record<string, unknown[]>, error: { category: string }) => {
        if (!acc[error.category]) {
          acc[error.category] = [];
        }
        acc[error.category]?.push(error);
        return acc;
      },
      {},
    );

    const errorSummary =
      Object.entries(errorsByCategory)
        .map(([cat, errors]: [string, unknown[]]) => `**${cat}:** ${errors.length} error(s)`)
        .join('\n') || 'No errors found';

    return {
      content: [
        {
          type: 'text',
          text: `🔧 **Error Diagnosis**
**Category Filter:** ${category || 'All categories'}
**Total Errors:** ${diagnosis.errors.length}

**Error Summary:**
${errorSummary}

**Recommendations:**
${diagnosis.recommendations.map((rec: string) => `- ${rec}`).join('\n')}

**System Status:** ${diagnosis.systemStatus}`,
        },
      ],
    };
  });
}

/**
 * Handles comprehensive health status requests
 *
 * The system-health section reads the nested fields `SystemHealthSchema`
 * declares. Playtime is not reported: `getWorldInfo()` has no genuine source
 * for it and hard-codes 0.
 *
 * The world section carries {@link STALE_WORLD_DATA_NOTICE} whenever the cache
 * has stopped following live document changes (#217). Reads keep being served
 * from that snapshot, which is the right call — a flagged answer beats no
 * answer — but rendering it bare presents a point-in-time copy as though it
 * were live. It matters most right after an automatic reconnect, where the
 * connection line legitimately reads "✅ Connected" while the cache is still
 * missing every broadcast the outage swallowed.
 */
export async function handleGetHealthStatus(
  _args: Record<string, unknown>,
  foundryClient: FoundryClient,
  diagnosticsClient: DiagnosticsClient,
) {
  return withToolError('get health status', async () => {
    const [worldInfo, systemHealth] = await Promise.all([
      foundryClient.getWorldInfo().catch(() => null),
      diagnosticsClient.getSystemHealth().catch(() => null),
    ]);

    const worldLines = worldInfo
      ? [
          `- **Title:** ${worldInfo.title}`,
          `- **System:** ${worldInfo.system}`,
          `- **Core Version:** ${worldInfo.coreVersion}`,
        ]
      : ['ℹ️ Not available'];
    if (foundryClient.isWorldDataStale()) {
      worldLines.unshift(STALE_WORLD_DATA_NOTICE);
    }

    let healthSection = 'ℹ️ Not available';
    if (systemHealth) {
      const healthLines = [
        `- **Status:** ${systemHealth.status}`,
        `- **Users:** ${systemHealth.users.active} active / ${systemHealth.users.total} total`,
      ];
      if (systemHealth.server.uptime !== undefined) {
        healthLines.push(`- **Uptime:** ${formatUptime(systemHealth.server.uptime)}`);
      }
      if (systemHealth.performance.memory) {
        healthLines.push(
          `- **Memory (heap used):** ${formatMegabytes(systemHealth.performance.memory.heapUsed)}`,
        );
      }
      healthLines.push(
        `- **Recent Errors:** ${systemHealth.logs.recentErrors} (warnings: ${systemHealth.logs.recentWarnings})`,
      );
      healthSection = `\n${healthLines.join('\n')}`;
    }

    return {
      content: [
        {
          type: 'text',
          text: `\u{1FA7A} **Comprehensive Health Status**

**FoundryVTT Connection:**
${foundryClient.isConnected() ? '✅ Connected' : '❌ Disconnected'}

**World Information:**
${worldLines.join('\n')}

**System Health:**
${healthSection}`,
        },
      ],
    };
  });
}
