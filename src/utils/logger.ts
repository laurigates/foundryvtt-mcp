/**
 * @fileoverview Centralized logging utility for FoundryVTT MCP Server
 *
 * This module provides a structured logging system with configurable log levels
 * and consistent formatting across the application. It respects the LOG_LEVEL
 * environment variable for controlling verbosity.
 *
 * @version 0.1.0
 * @author FoundryVTT MCP Team
 */

import { config } from '../config/index.js';

/**
 * Available log levels in order of severity
 *
 * - debug: Detailed information for debugging
 * - info: General information about application flow
 * - warn: Warning messages for potential issues
 * - error: Error messages for failures and exceptions
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Centralized logger class for structured application logging
 *
 * Provides methods for different log levels and automatically filters
 * messages based on the configured minimum log level.
 *
 * @class Logger
 * @example
 * ```typescript
 * import { logger } from './utils/logger.js';
 *
 * logger.info('Server starting...');
 * logger.error('Connection failed:', error);
 * logger.debug('Detailed debug info', { data: someObject });
 * ```
 */
class Logger {
  private logLevel: LogLevel;
  private levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  /**
   * Creates a new Logger instance
   *
   * @param logLevel - Minimum log level to display (default: 'info')
   */
  constructor(logLevel: LogLevel = 'info') {
    this.logLevel = logLevel;
  }

  /**
   * Determines if a message should be logged based on current log level
   *
   * @private
   * @param level - The log level to check
   * @returns True if the message should be logged, false otherwise
   */
  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.logLevel];
  }

  /**
   * Formats a log message with timestamp, level, and optional metadata
   *
   * @private
   * @param level - The log level
   * @param message - The main log message
   * @param meta - Optional metadata object
   * @returns Formatted log message string
   */
  private formatMessage(level: LogLevel, message: string, meta?: unknown): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
  }

  /**
   * Logs a debug message (lowest priority)
   *
   * Used for detailed information that's only needed when debugging issues.
   * Only shown when LOG_LEVEL is set to 'debug'.
   *
   * @param message - The debug message
   * @param meta - Optional metadata object
   * @example
   * ```typescript
   * logger.debug('Processing user request', { userId: '123', action: 'search' });
   * ```
   */
  debug(message: string, meta?: unknown): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, meta));
    }
  }

  /**
   * Logs an informational message
   *
   * Used for general information about application flow and important events.
   * Shown when LOG_LEVEL is 'debug' or 'info'.
   *
   * @param message - The info message
   * @param meta - Optional metadata object
   * @example
   * ```typescript
   * logger.info('Server started successfully', { port: 3000 });
   * ```
   */
  info(message: string, meta?: unknown): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, meta));
    }
  }

  /**
   * Logs a warning message
   *
   * Used for potentially problematic situations that don't prevent operation
   * but should be noted. Shown when LOG_LEVEL is 'debug', 'info', or 'warn'.
   *
   * @param message - The warning message
   * @param meta - Optional metadata object
   * @example
   * ```typescript
   * logger.warn('Deprecated API endpoint used', { endpoint: '/old-api' });
   * ```
   */
  warn(message: string, meta?: unknown): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  /**
   * Logs an error message (highest priority)
   *
   * Used for error conditions and exceptions that affect application operation.
   * Always shown regardless of LOG_LEVEL setting.
   *
   * @param message - The error message
   * @param error - Optional error object or metadata
   * @example
   * ```typescript
   * logger.error('Database connection failed', error);
   * logger.error('Invalid user input', { input: userData, validation: errors });
   * ```
   */
  error(message: string, error?: unknown): void {
    if (this.shouldLog('error')) {
      const errorDetails = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error;
      console.error(this.formatMessage('error', message, errorDetails));
    }
  }
}

/**
 * Global logger instance
 *
 * Pre-configured logger instance ready for use throughout the application.
 * Respects the LOG_LEVEL environment variable for filtering messages.
 *
 * @example
 * ```typescript
 * import { logger } from './utils/logger.js';
 *
 * logger.info('Application starting');
 * logger.error('Something went wrong', error);
 * ```
 */
export const logger = new Logger(config.logLevel);
