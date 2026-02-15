import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the config module before importing logger
vi.mock('../../config/index.js', () => ({
  config: {
    logLevel: 'info',
  },
}));

class Logger {
  private logLevel: 'debug' | 'info' | 'warn' | 'error';
  private levels: Record<'debug' | 'info' | 'warn' | 'error', number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(logLevel: 'debug' | 'info' | 'warn' | 'error' = 'info') {
    this.logLevel = logLevel;
  }

  private shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
    return this.levels[level] >= this.levels[this.logLevel];
  }

  private formatMessage(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    meta?: any,
  ): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
  }

  debug(message: string, meta?: any): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, meta));
    }
  }

  info(message: string, meta?: any): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, meta));
    }
  }

  warn(message: string, meta?: any): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  error(message: string, error?: any): void {
    if (this.shouldLog('error')) {
      const errorDetails =
        error instanceof Error ? { message: error.message, stack: error.stack } : error;
      console.error(this.formatMessage('error', message, errorDetails));
    }
  }
}

describe('Logger', () => {
  let consoleSpy: any;

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('log level filtering', () => {
    it('should log debug messages when log level is debug', () => {
      const logger = new Logger('debug');
      logger.debug('test message');
      expect(consoleSpy.debug).toHaveBeenCalledOnce();
    });

    it('should not log debug messages when log level is info', () => {
      const logger = new Logger('info');
      logger.debug('test message');
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it('should log info messages when log level is info', () => {
      const logger = new Logger('info');
      logger.info('test message');
      expect(consoleSpy.info).toHaveBeenCalledOnce();
    });

    it('should log warn messages when log level is warn', () => {
      const logger = new Logger('warn');
      logger.warn('test message');
      expect(consoleSpy.warn).toHaveBeenCalledOnce();
    });

    it('should log error messages at all log levels', () => {
      const logger = new Logger('debug');
      logger.error('test message');
      expect(consoleSpy.error).toHaveBeenCalledOnce();
    });
  });

  describe('message formatting', () => {
    it('should format messages with timestamp and level', () => {
      const logger = new Logger('debug');
      logger.info('test message');

      const call = consoleSpy.info.mock.calls[0][0];
      expect(call).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] INFO: test message$/);
    });

    it('should include metadata in formatted message', () => {
      const logger = new Logger('debug');
      const metadata = { key: 'value', number: 42 };
      logger.info('test message', metadata);

      const call = consoleSpy.info.mock.calls[0][0];
      expect(call).toContain('test message');
      expect(call).toContain(JSON.stringify(metadata));
    });

    it('should format error objects properly', () => {
      const logger = new Logger('debug');
      const error = new Error('test error');
      logger.error('test message', error);

      const call = consoleSpy.error.mock.calls[0][0];
      expect(call).toContain('test message');
      expect(call).toContain('"message":"test error"');
      expect(call).toContain('"stack"');
    });
  });

  describe('default log level', () => {
    it('should default to info log level', () => {
      const logger = new Logger();
      logger.debug('debug message');
      logger.info('info message');

      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.info).toHaveBeenCalledOnce();
    });
  });
});
