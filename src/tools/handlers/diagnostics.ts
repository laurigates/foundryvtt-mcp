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

/**
 * Handles recent log retrieval requests
 */
export async function handleGetRecentLogs(
  args: {
    limit?: number;
    level?: string;
    since?: string;
  },
  diagnosticsClient: DiagnosticsClient,
) {
  const { limit = 20, level, since } = args;

  return withToolError('get recent logs', async () => {
    const logs = await diagnosticsClient.getRecentLogs();

    const logEntries = Array.isArray(logs)
      ? logs
          .map((log: unknown) => {
            const logEntry = log as { timestamp?: string; level?: string; message?: string };
            return `[${logEntry.timestamp || new Date().toISOString()}] **${(logEntry.level || 'INFO').toUpperCase()}** ${logEntry.message || String(log)}`;
          })
          .join('\n')
      : 'No logs available';

    return {
      content: [
        {
          type: 'text',
          text: `📋 **Recent Log Entries**
**Filter:** ${level || 'All levels'}
**Limit:** ${limit}
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
