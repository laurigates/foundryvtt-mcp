import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock process.env before importing the config
const mockEnv = {
  MCP_SERVER_NAME: 'test-server',
  MCP_SERVER_VERSION: '1.0.0',
  LOG_LEVEL: 'debug',
  NODE_ENV: 'test',
  FOUNDRY_URL: 'http://localhost:30000',
  FOUNDRY_API_KEY: 'test-api-key',
  FOUNDRY_USERNAME: 'testuser',
  FOUNDRY_PASSWORD: 'testpass',
  FOUNDRY_SOCKET_PATH: '/custom/socket.io/',
  FOUNDRY_TIMEOUT: '5000',
  FOUNDRY_RETRY_ATTEMPTS: '5',
  FOUNDRY_RETRY_DELAY: '500',
  CACHE_ENABLED: 'true',
  CACHE_TTL_SECONDS: '600',
  CACHE_MAX_SIZE: '2000',
};

describe('Config', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let exitSpy: any;

  beforeEach(async () => {
    originalEnv = process.env;
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    // Reset any cached config
    try {
      const { resetConfig } = await import('../index.js');
      resetConfig();
    } catch {
      // Ignore import errors during setup
    }
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe('valid configuration', () => {
    it('should load configuration from environment variables', async () => {
      process.env = { ...mockEnv };

      const { config, resetConfig } = await import('../index.js');
      resetConfig(); // Reset any cached config

      expect(config.serverName).toBe('test-server');
      expect(config.serverVersion).toBe('1.0.0');
      expect(config.logLevel).toBe('debug');
      expect(config.nodeEnv).toBe('test');
      expect(config.foundry.url).toBe('http://localhost:30000');
      expect(config.foundry.apiKey).toBe('test-api-key');
      expect(config.foundry.username).toBe('testuser');
      expect(config.foundry.password).toBe('testpass');
      expect(config.foundry.socketPath).toBe('/custom/socket.io/');
      expect(config.foundry.timeout).toBe(5000);
      expect(config.foundry.retryAttempts).toBe(5);
      expect(config.foundry.retryDelay).toBe(500);
      expect(config.cache.enabled).toBe(true);
      expect(config.cache.ttlSeconds).toBe(600);
      expect(config.cache.maxSize).toBe(2000);
    });

    it('should use default values when environment variables are not set', async () => {
      process.env = { FOUNDRY_URL: 'http://localhost:30000' };

      const { config, resetConfig } = await import('../index.js');
      resetConfig(); // Reset any cached config

      expect(config.serverName).toBe('foundry-mcp-server');
      expect(config.serverVersion).toBe('0.1.0');
      expect(config.logLevel).toBe('info');
      expect(config.nodeEnv).toBe('development');
      expect(config.foundry.socketPath).toBe('/socket.io/');
      expect(config.foundry.timeout).toBe(10000);
      expect(config.foundry.retryAttempts).toBe(3);
      expect(config.foundry.retryDelay).toBe(1000);
      expect(config.cache.enabled).toBe(true);
      expect(config.cache.ttlSeconds).toBe(300);
      expect(config.cache.maxSize).toBe(1000);
    });
  });

  describe('configuration validation', () => {
    it('should throw error when FOUNDRY_URL is missing in test environment', async () => {
      process.env = { NODE_ENV: 'test' };

      const { config, resetConfig } = await import('../index.js');
      resetConfig(); // Reset any cached config

      expect(() => config.foundry.url).toThrow();
    });

    it('should exit process when FOUNDRY_URL is missing in non-test environment', async () => {
      process.env = { NODE_ENV: 'production' };

      const { config, resetConfig } = await import('../index.js');
      resetConfig(); // Reset any cached config

      expect(() => config.foundry.url).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should throw error when FOUNDRY_URL is invalid in test environment', async () => {
      process.env = {
        FOUNDRY_URL: 'invalid-url',
        NODE_ENV: 'test',
      };

      const { config, resetConfig } = await import('../index.js');
      resetConfig(); // Reset any cached config

      expect(() => config.foundry.url).toThrow();
    });

    it('should throw error when LOG_LEVEL is invalid in test environment', async () => {
      process.env = {
        FOUNDRY_URL: 'http://localhost:30000',
        LOG_LEVEL: 'invalid-level',
        NODE_ENV: 'test',
      };

      const { config, resetConfig } = await import('../index.js');
      resetConfig(); // Reset any cached config

      expect(() => config.logLevel).toThrow();
    });

    it('should throw error when NODE_ENV is invalid in test environment', async () => {
      process.env = {
        FOUNDRY_URL: 'http://localhost:30000',
        NODE_ENV: 'invalid-env',
      };

      const { config, resetConfig } = await import('../index.js');
      resetConfig(); // Reset any cached config

      expect(() => config.nodeEnv).toThrow();
    });
  });

  describe('type conversion', () => {
    it('should convert string numbers to numbers', async () => {
      process.env = {
        FOUNDRY_URL: 'http://localhost:30000',
        FOUNDRY_TIMEOUT: '15000',
        FOUNDRY_RETRY_ATTEMPTS: '10',
        FOUNDRY_RETRY_DELAY: '2000',
        CACHE_TTL_SECONDS: '900',
        CACHE_MAX_SIZE: '5000',
      };

      const { config, resetConfig } = await import('../index.js');
      resetConfig(); // Reset any cached config

      expect(config.foundry.timeout).toBe(15000);
      expect(config.foundry.retryAttempts).toBe(10);
      expect(config.foundry.retryDelay).toBe(2000);
      expect(config.cache.ttlSeconds).toBe(900);
      expect(config.cache.maxSize).toBe(5000);
    });

    it('should convert string booleans to booleans', async () => {
      process.env = {
        FOUNDRY_URL: 'http://localhost:30000',
        USE_REST_MODULE: 'true',
        CACHE_ENABLED: 'false',
      };

      const { config, resetConfig } = await import('../index.js');
      resetConfig(); // Reset any cached config

      expect(config.cache.enabled).toBe(false);
    });
  });
});
