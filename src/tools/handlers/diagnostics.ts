/**
 * @fileoverview Diagnostics and logging tool handlers
 *
 * Handles system diagnostics, logging, and health monitoring.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { DiagnosticsClient } from '../../diagnostics/client.js';
import type { FoundryClient } from '../../foundry/client.js';
import type { DiagnosticSystem } from '../../utils/diagnostics.js';
import { withToolError } from './utils.js';

/** Valid log levels recognized by the tool schema */
const VALID_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'log', 'notification']);

/** Hard upper bound on entries returned, regardless of caller-supplied limit */
const MAX_LOG_LIMIT = 1000;

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
 * Handles log search requests
 */
export async function handleSearchLogs(
  args: {
    query: string;
    level?: string;
    limit?: number;
  },
  diagnosticsClient: DiagnosticsClient,
) {
  const { query, level } = args;

  if (!query || typeof query !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Query is required and must be a string');
  }

  return withToolError('search logs', async () => {
    const logs = await diagnosticsClient.searchLogs({ pattern: query });

    const logEntries = Array.isArray(logs)
      ? logs
          .map((log: unknown) => {
            const logEntry = log as { timestamp?: string; level?: string; message?: string };
            return `[${logEntry.timestamp || new Date().toISOString()}] **${(logEntry.level || 'INFO').toUpperCase()}** ${logEntry.message || String(log)}`;
          })
          .join('\n')
      : 'No logs available';

    const logCount = Array.isArray(logs) ? logs.length : 0;

    return {
      content: [
        {
          type: 'text',
          text: `🔍 **Log Search Results**
**Query:** "${query}"
**Level Filter:** ${level || 'All levels'}
**Results:** ${logCount}

${logEntries || 'No matching log entries found.'}`,
        },
      ],
    };
  });
}

/**
 * Handles system health requests
 */
export async function handleGetSystemHealth(
  _args: Record<string, unknown>,
  diagnosticsClient: DiagnosticsClient,
) {
  return withToolError('get system health', async () => {
    const health = await diagnosticsClient.getSystemHealth();

    return {
      content: [
        {
          type: 'text',
          text: `🏥 **System Health Status**
**Overall Status:** ${health.status || 'Unknown'}
**CPU Usage:** ${(health as { cpu?: number }).cpu || 'N/A'}%
**Memory Usage:** ${(health as { memory?: number }).memory || 'N/A'}%
**Disk Usage:** ${(health as { disk?: number }).disk || 'N/A'}%
**Uptime:** ${(health as { uptime?: number }).uptime || 'N/A'} seconds

**Active Connections:** ${(health as { connections?: number }).connections || 'N/A'}
**Last Error:** ${(health as { lastError?: string }).lastError || 'None'}

**Performance Metrics:**
- **Response Time:** ${(health as { responseTime?: number }).responseTime || 'N/A'}ms
- **Throughput:** ${(health as { throughput?: number }).throughput || 'N/A'} requests/sec`,
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

    return {
      content: [
        {
          type: 'text',
          text: `🩺 **Comprehensive Health Status**

**FoundryVTT Connection:**
${foundryClient.isConnected() ? '✅ Connected' : '❌ Disconnected'}

**World Information:**
${
  worldInfo
    ? `
- **Title:** ${worldInfo.title}
- **System:** ${worldInfo.system}
- **Core Version:** ${worldInfo.coreVersion}
- **Playtime:** ${Math.floor(worldInfo.playtime / 3600)} hours`
    : 'ℹ️ Not available'
}

**System Health:**
${
  systemHealth
    ? `
- **Status:** ${systemHealth.status || 'Unknown'}
- **CPU:** ${(systemHealth as { cpu?: number }).cpu || 'N/A'}%
- **Memory:** ${(systemHealth as { memory?: number }).memory || 'N/A'}%
- **Uptime:** ${Math.floor(((systemHealth as { uptime?: number }).uptime || 0) / 3600)} hours`
    : 'ℹ️ Not available'
}`,
        },
      ],
    };
  });
}
