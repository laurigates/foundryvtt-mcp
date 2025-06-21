/**
 * @fileoverview Type definitions for FoundryVTT diagnostics and logging
 * 
 * This module provides TypeScript interfaces for log entries, system health metrics,
 * and diagnostic data structures used by the MCP server for FoundryVTT monitoring.
 * 
 * @version 0.1.0
 * @author FoundryVTT MCP Team
 */

/**
 * Log entry interface representing a single log message with metadata
 * 
 * @interface LogEntry
 * @example
 * ```typescript
 * const logEntry: LogEntry = {
 *   timestamp: '2024-01-01T12:00:00.000Z',
 *   level: 'error',
 *   message: 'TypeError: Cannot read property of undefined',
 *   stack: 'Error stack trace...',
 *   source: 'module'
 * };
 * ```
 */
export interface LogEntry {
  /** ISO timestamp when the log entry was created */
  timestamp: string;
  /** Log level indicating severity */
  level: 'log' | 'warn' | 'error' | 'info' | 'notification';
  /** The actual log message content */
  message: string;
  /** Optional stack trace for errors */
  stack?: string;
  /** Source component that generated the log */
  source: 'foundry' | 'module' | 'system' | 'api' | 'unknown';
}

/**
 * Server information including FoundryVTT and system versions
 * 
 * @interface ServerInfo
 */
export interface ServerInfo {
  /** FoundryVTT version string */
  foundryVersion: string;
  /** Game system version */
  systemVersion: string;
  /** Current world identifier */
  worldId: string;
  /** Server uptime in seconds (if available) */
  uptime?: number;
}

/**
 * User session information and statistics
 * 
 * @interface UserInfo
 */
export interface UserInfo {
  /** Total number of users */
  total: number;
  /** Number of currently active users */
  active: number;
  /** Number of GM users */
  gm: number;
}

/**
 * Module information and statistics
 * 
 * @interface ModuleInfo
 */
export interface ModuleInfo {
  /** Total number of installed modules */
  total: number;
  /** Number of currently active modules */
  active: number;
}

/**
 * Performance metrics for system monitoring
 * 
 * @interface PerformanceInfo
 */
export interface PerformanceInfo {
  /** Node.js memory usage (if available) */
  memory?: NodeJS.MemoryUsage;
  /** Number of connected WebSocket clients */
  connectedClients: number;
}

/**
 * Log buffer statistics and metrics
 * 
 * @interface LogInfo
 */
export interface LogInfo {
  /** Current number of entries in the log buffer */
  bufferSize: number;
  /** Number of recent error entries */
  recentErrors: number;
  /** Number of recent warning entries */
  recentWarnings: number;
  /** Error rate as a percentage */
  errorRate: number;
}

/**
 * Overall system health status and metrics
 * 
 * @interface SystemHealth
 * @example
 * ```typescript
 * const health: SystemHealth = {
 *   timestamp: '2024-01-01T12:00:00.000Z',
 *   server: { foundryVersion: '11.315', systemVersion: '5e 2.4.1', worldId: 'my-world' },
 *   users: { total: 5, active: 3, gm: 1 },
 *   modules: { total: 50, active: 35 },
 *   performance: { connectedClients: 3 },
 *   logs: { bufferSize: 500, recentErrors: 2, recentWarnings: 5, errorRate: 0.1 },
 *   status: 'healthy'
 * };
 * ```
 */
export interface SystemHealth {
  /** Timestamp when health data was collected */
  timestamp: string;
  /** Server information and versions */
  server: ServerInfo;
  /** User session information */
  users: UserInfo;
  /** Module information */
  modules: ModuleInfo;
  /** Performance metrics */
  performance: PerformanceInfo;
  /** Log statistics */
  logs: LogInfo;
  /** Overall health status */
  status: 'healthy' | 'warning' | 'critical';
}

/**
 * Error categorization for diagnostics
 * 
 * @interface ErrorCategories
 */
export interface ErrorCategories {
  [category: string]: number;
}

/**
 * Diagnostic suggestion for resolving issues
 * 
 * @interface DiagnosticSuggestion
 */
export interface DiagnosticSuggestion {
  /** Error category this suggestion applies to */
  category: string;
  /** Human-readable suggestion text */
  suggestion: string;
  /** Priority level for addressing the issue */
  priority: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Summary of error analysis
 * 
 * @interface ErrorSummary
 */
export interface ErrorSummary {
  /** Total number of errors in the analyzed timeframe */
  totalErrors: number;
  /** Number of unique error messages */
  uniqueErrors: number;
  /** Categorized error counts */
  categories: ErrorCategories;
}

/**
 * Complete error diagnosis with analysis and suggestions
 * 
 * @interface ErrorDiagnosis
 * @example
 * ```typescript
 * const diagnosis: ErrorDiagnosis = {
 *   timestamp: '2024-01-01T12:00:00.000Z',
 *   timeframe: '3600 seconds',
 *   summary: {
 *     totalErrors: 5,
 *     uniqueErrors: 3,
 *     categories: { 'TypeError': 2, 'Network': 3 }
 *   },
 *   recentErrors: [...],
 *   suggestions: [...],
 *   healthScore: 75
 * };
 * ```
 */
export interface ErrorDiagnosis {
  /** Timestamp of the diagnosis */
  timestamp: string;
  /** Time window analyzed for errors */
  timeframe: string;
  /** Summary of errors found */
  summary: ErrorSummary;
  /** Most recent error entries */
  recentErrors: LogEntry[];
  /** Diagnostic suggestions based on error patterns */
  suggestions: DiagnosticSuggestion[];
  /** Overall health score (0-100) */
  healthScore: number;
}

/**
 * Parameters for searching logs
 * 
 * @interface LogSearchParams
 */
export interface LogSearchParams {
  /** Number of log lines to retrieve */
  lines?: number;
  /** Filter by specific log level */
  level?: LogEntry['level'];
  /** Filter logs since this timestamp */
  since?: string;
  /** Filter by log source */
  source?: LogEntry['source'];
  /** Include stack traces in results */
  includeStack?: boolean;
}

/**
 * Parameters for log pattern searching
 * 
 * @interface LogPatternSearchParams
 */
export interface LogPatternSearchParams {
  /** Regular expression pattern to search for */
  pattern: string;
  /** Time window in seconds to search within */
  timeframe?: string;
  /** Filter by specific log level */
  level?: LogEntry['level'];
  /** Case-sensitive search */
  caseSensitive?: boolean;
}

/**
 * Response structure for log retrieval operations
 * 
 * @interface LogResponse
 */
export interface LogResponse {
  /** Array of log entries */
  logs: LogEntry[];
  /** Total number of log entries returned */
  total: number;
  /** Current size of the log buffer */
  bufferSize?: number;
  /** Maximum size of the log buffer */
  maxBufferSize?: number;
}

/**
 * Response structure for log search operations
 * 
 * @interface LogSearchResponse
 */
export interface LogSearchResponse {
  /** Array of matching log entries */
  logs: LogEntry[];
  /** Number of matches found */
  matches: number;
  /** Search pattern used */
  pattern: string;
  /** Timeframe searched */
  searchTimeframe: string;
}