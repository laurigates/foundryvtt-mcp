/**
 * @fileoverview DiagnosticsClient for accessing FoundryVTT logs and system health
 * 
 * This module provides a client interface for accessing diagnostic information
 * from FoundryVTT through the REST API module's diagnostic endpoints.
 * 
 * @version 0.1.0
 * @author FoundryVTT MCP Team
 */

import { FoundryClient } from '../foundry/client.js';
import { logger } from '../utils/logger.js';
import type {
  LogSearchParams,
  LogPatternSearchParams,
} from './types.js';
import {
  LogEntrySchema,
  LogResponseSchema,
  LogSearchResponseSchema,
  SystemHealthSchema,
  ErrorDiagnosisSchema
} from './types.js';
import type { z } from 'zod';

type LogEntry = z.infer<typeof LogEntrySchema>;
type LogResponse = z.infer<typeof LogResponseSchema>;
type LogSearchResponse = z.infer<typeof LogSearchResponseSchema>;
type SystemHealth = z.infer<typeof SystemHealthSchema>;
type ErrorDiagnosis = z.infer<typeof ErrorDiagnosisSchema>;

/**
 * Client for accessing FoundryVTT diagnostic and logging information
 * 
 * Provides methods to retrieve logs, search for specific patterns,
 * monitor system health, and analyze errors through the REST API.
 * 
 * @class DiagnosticsClient
 * @example
 * ```typescript
 * const diagnostics = new DiagnosticsClient(foundryClient);
 * 
 * // Get recent errors
 * const errors = await diagnostics.getRecentLogs({ level: 'error', lines: 20 });
 * 
 * // Search for specific patterns
 * const matches = await diagnostics.searchLogs({ pattern: 'TypeError', timeframe: '3600' });
 * 
 * // Check system health
 * const health = await diagnostics.getSystemHealth();
 * ```
 */
export class DiagnosticsClient {
  /**
   * Create a new DiagnosticsClient instance
   * 
   * @param foundryClient - The FoundryClient instance to use for API calls
   */
  constructor(private foundryClient: FoundryClient) {}

  /**
   * Get recent log entries with optional filtering
   * 
   * @param params - Search parameters for filtering logs
   * @returns Promise resolving to log response with entries and metadata
   * 
   * @example
   * ```typescript
   * // Get last 50 log entries
   * const logs = await diagnostics.getRecentLogs();
   * 
   * // Get only error logs from the last hour
   * const errors = await diagnostics.getRecentLogs({
   *   level: 'error',
   *   since: new Date(Date.now() - 3600000).toISOString()
   * });
   * 
   * // Get logs with stack traces included
   * const detailed = await diagnostics.getRecentLogs({
   *   lines: 100,
   *   includeStack: true
   * });
   * ```
   */
  async getRecentLogs(params: LogSearchParams = {}): Promise<LogResponse> {
    try {
      logger.debug('DiagnosticsClient | Getting recent logs', params);

      const searchParams = new URLSearchParams();
      
      if (params.lines !== undefined) {
        searchParams.set('lines', params.lines.toString());
      }
      if (params.level) {
        searchParams.set('level', params.level);
      }
      if (params.since) {
        searchParams.set('since', params.since);
      }
      if (params.source) {
        searchParams.set('source', params.source);
      }
      if (params.includeStack !== undefined) {
        searchParams.set('includeStack', params.includeStack.toString());
      }

      const queryString = searchParams.toString();
      const url = `/api/diagnostics/logs${queryString ? `?${queryString}` : ''}`;
      
      const response = await this.foundryClient.get(url);
      const parsed = LogResponseSchema.parse(response.data);

      logger.debug('DiagnosticsClient | Retrieved logs', {
        count: parsed.total,
        bufferSize: parsed.bufferSize
      });

      return parsed;
    } catch (error) {
      logger.error('DiagnosticsClient | Failed to get recent logs:', error);
      throw new Error(`Failed to retrieve recent logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Search log entries for specific patterns using regular expressions
   * 
   * @param params - Search parameters including pattern and filters
   * @returns Promise resolving to matching log entries
   * 
   * @example
   * ```typescript
   * // Search for any TypeError occurrences
   * const typeErrors = await diagnostics.searchLogs({
   *   pattern: 'TypeError'
   * });
   * 
   * // Search for network errors in the last hour
   * const networkErrors = await diagnostics.searchLogs({
   *   pattern: 'Failed to fetch|Network Error',
   *   timeframe: '3600',
   *   level: 'error'
   * });
   * 
   * // Case-sensitive search for specific module errors
   * const moduleErrors = await diagnostics.searchLogs({
   *   pattern: 'Module.*failed',
   *   caseSensitive: true
   * });
   * ```
   */
  async searchLogs(params: LogPatternSearchParams): Promise<LogSearchResponse> {
    try {
      logger.debug('DiagnosticsClient | Searching logs', params);

      const searchParams = new URLSearchParams();
      searchParams.set('pattern', params.pattern);
      
      if (params.timeframe) {
        searchParams.set('timeframe', params.timeframe);
      }
      if (params.level) {
        searchParams.set('level', params.level);
      }
      if (params.caseSensitive !== undefined) {
        searchParams.set('caseSensitive', params.caseSensitive.toString());
      }

      const url = `/api/diagnostics/search?${searchParams.toString()}`;
      const response = await this.foundryClient.get(url);
      const parsed = LogSearchResponseSchema.parse(response.data);

      logger.debug('DiagnosticsClient | Search completed', {
        pattern: params.pattern,
        matches: parsed.matches
      });

      return parsed;
    } catch (error) {
      logger.error('DiagnosticsClient | Failed to search logs:', error);
      throw new Error(`Failed to search logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get comprehensive system health and performance metrics
   * 
   * @returns Promise resolving to complete system health information
   * 
   * @example
   * ```typescript
   * const health = await diagnostics.getSystemHealth();
   * 
   * console.log(`Server status: ${health.status}`);
   * console.log(`Active users: ${health.users.active}/${health.users.total}`);
   * console.log(`Recent errors: ${health.logs.recentErrors}`);
   * console.log(`Health score: ${health.healthScore}%`);
   * 
   * if (health.status === 'critical') {
   *   console.warn('Server requires immediate attention!');
   * }
   * ```
   */
  async getSystemHealth(): Promise<SystemHealth> {
    try {
      logger.debug('DiagnosticsClient | Getting system health');

      const response = await this.foundryClient.get('/api/diagnostics/health');
      const parsed = SystemHealthSchema.parse(response.data);

      logger.debug('DiagnosticsClient | System health retrieved', {
        status: parsed.status,
        activeUsers: parsed.users?.active,
        recentErrors: parsed.logs?.recentErrors
      });

      return parsed;
    } catch (error) {
      logger.error('DiagnosticsClient | Failed to get system health:', error);
      throw new Error(`Failed to retrieve system health: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Analyze recent errors and get diagnostic suggestions
   * 
   * @param timeframe - Time window in seconds to analyze (default: 3600)
   * @returns Promise resolving to error diagnosis with suggestions
   * 
   * @example
   * ```typescript
   * // Analyze errors from the last hour
   * const diagnosis = await diagnostics.diagnoseErrors();
   * 
   * // Analyze errors from the last 30 minutes
   * const recentDiagnosis = await diagnostics.diagnoseErrors(1800);
   * 
   * console.log(`Health score: ${diagnosis.healthScore}/100`);
   * console.log(`Total errors: ${diagnosis.summary.totalErrors}`);
   * 
   * // Display suggestions
   * diagnosis.suggestions.forEach(suggestion => {
   *   console.log(`${suggestion.priority.toUpperCase()}: ${suggestion.suggestion}`);
   * });
   * ```
   */
  async diagnoseErrors(timeframe: number = 3600): Promise<ErrorDiagnosis> {
    try {
      logger.debug('DiagnosticsClient | Diagnosing errors', { timeframe });

      const searchParams = new URLSearchParams();
      searchParams.set('timeframe', timeframe.toString());

      const url = `/api/diagnostics/errors?${searchParams.toString()}`;
      const response = await this.foundryClient.get(url);
      const parsed = ErrorDiagnosisSchema.parse(response.data);

      logger.debug('DiagnosticsClient | Error diagnosis completed', {
        totalErrors: parsed.summary?.totalErrors,
        healthScore: parsed.healthScore,
        suggestionCount: parsed.suggestions?.length
      });

      return parsed;
    } catch (error) {
      logger.error('DiagnosticsClient | Failed to diagnose errors:', error);
      throw new Error(`Failed to diagnose errors: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get errors filtered by severity and time window
   * 
   * @param timeframe - Time window in seconds (default: 3600)
   * @param level - Log level to filter by (default: 'error')
   * @returns Promise resolving to filtered log entries
   * 
   * @example
   * ```typescript
   * // Get all errors from the last 2 hours
   * const errors = await diagnostics.getErrorsOnly(7200);
   * 
   * // Get warnings from the last 30 minutes
   * const warnings = await diagnostics.getErrorsOnly(1800, 'warn');
   * ```
   */
  async getErrorsOnly(timeframe: number = 3600, level: LogEntry['level'] = 'error'): Promise<LogEntry[]> {
    try {
      const since = new Date(Date.now() - (timeframe * 1000)).toISOString();
      
      const response = await this.getRecentLogs({
        level,
        since,
        lines: 1000, // Get a large number to ensure we capture all errors
        includeStack: true
      });

      return response.logs;
    } catch (error) {
      logger.error('DiagnosticsClient | Failed to get errors only:', error);
      throw new Error(`Failed to retrieve ${level} logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Monitor system health and return status summary
   * 
   * @returns Promise resolving to simplified health status
   * 
   * @example
   * ```typescript
   * const status = await diagnostics.getHealthStatus();
   * // Returns: { status: 'healthy' | 'warning' | 'critical', score: number }
   * ```
   */
  async getHealthStatus(): Promise<{ status: SystemHealth['status']; score?: number }> {
    try {
      const health = await this.getSystemHealth();
      return {
        status: health.status
      };
    } catch (error) {
      logger.error('DiagnosticsClient | Failed to get health status:', error);
      return { status: 'critical' };
    }
  }

  /**
   * Check if diagnostics API is available
   * 
   * @returns Promise resolving to boolean indicating availability
   * 
   * @example
   * ```typescript
   * const available = await diagnostics.isAvailable();
   * if (!available) {
   *   console.log('Diagnostics API not available - check module installation');
   * }
   * ```
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.foundryClient.get('/api/diagnostics/health');
      return true;
    } catch (error) {
      logger.debug('DiagnosticsClient | Diagnostics API not available:', error);
      return false;
    }
  }
}