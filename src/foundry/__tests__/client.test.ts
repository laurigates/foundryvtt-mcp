import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('axios');
vi.mock('socket.io-client');
vi.mock('../auth.js', () => ({
  authenticateFoundry: vi
    .fn()
    .mockResolvedValue({ session: 'test-session', userId: 'test-user-id' }),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('../../config/index.js', () => ({
  config: {
    logLevel: 'info',
  },
}));

const { FoundryClient } = await import('../client.js');

const mockAxios = vi.mocked(axios);

describe('FoundryClient', () => {
  let client: InstanceType<typeof FoundryClient>;
  let mockAxiosInstance: any;

  beforeEach(() => {
    mockAxiosInstance = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    };

    vi.clearAllMocks();
    mockAxios.create = vi.fn().mockReturnValue(mockAxiosInstance);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      client = new FoundryClient({ baseUrl: 'http://localhost:30000' });
      expect(client).toBeDefined();
      expect(client.isConnected()).toBe(false);
    });

    it('should throw on empty baseUrl', () => {
      expect(() => new FoundryClient({ baseUrl: '' })).toThrow('baseUrl is required');
    });

    it('should throw on invalid baseUrl', () => {
      expect(() => new FoundryClient({ baseUrl: 'not-a-url' })).toThrow('Invalid baseUrl');
    });

    it('should configure axios with apiKey interceptor when provided', () => {
      client = new FoundryClient({ baseUrl: 'http://localhost:30000', apiKey: 'test-key' });
      expect(mockAxios.create).toHaveBeenCalled();
    });
  });

  describe('REST API mode (with apiKey)', () => {
    beforeEach(() => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-api-key',
      });
    });

    it('should connect via REST API', async () => {
      mockAxiosInstance.get.mockResolvedValue({ status: 200, data: {} });
      await client.connect();
      expect(client.isConnected()).toBe(true);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/status');
    });

    it('should search actors via REST API', async () => {
      const mockData = { actors: [{ _id: '1', name: 'Hero', type: 'character' }] };
      mockAxiosInstance.get.mockResolvedValue({ data: mockData });

      const result = await client.searchActors({ query: 'Hero' });
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/actors', {
        params: { query: 'Hero' },
      });
      expect(result.actors).toEqual(mockData.actors);
    });

    it('should search items via REST API', async () => {
      const mockData = { items: [{ _id: '1', name: 'Sword', type: 'weapon' }] };
      mockAxiosInstance.get.mockResolvedValue({ data: mockData });

      const result = await client.searchItems({ query: 'Sword', type: 'weapon', limit: 10 });
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/items', {
        params: { query: 'Sword', type: 'weapon', limit: 10 },
      });
      expect(result.items).toEqual(mockData.items);
    });

    it('should get world info via REST API', async () => {
      const mockWorld = { id: 'world-1', title: 'Test World', system: 'dnd5e' };
      mockAxiosInstance.get.mockResolvedValue({ data: mockWorld });

      const result = await client.getWorldInfo();
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/world');
      expect(result).toEqual(mockWorld);
    });

    it('should retry failed requests', async () => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-api-key',
        retryAttempts: 2,
        retryDelay: 10,
      });

      mockAxiosInstance.get
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ data: { actors: [] } });

      const result = await client.searchActors({ query: 'test' });
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(3);
      expect(result.actors).toEqual([]);
    });

    it('should fail after max retry attempts', async () => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-api-key',
        retryAttempts: 1,
        retryDelay: 10,
      });

      mockAxiosInstance.get.mockRejectedValue(new Error('Persistent error'));

      await expect(client.searchActors({ query: 'test' })).rejects.toThrow('Persistent error');
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2); // Initial + 1 retry
    });
  });

  /**
   * CN-6: retry/backoff matrix (Issue #136).
   *
   * Verifies the documented exception list:
   *   - 4xx errors (except 429) fail fast — no retry.
   *   - 429 is retried alongside 5xx and transport errors.
   *   - Backoff delays follow baseDelay * 2^(attempt-1) (within jitter).
   */
  describe('retry/backoff matrix (CN-6)', () => {
    /** Construct a 4xx-shaped AxiosError so executeWithRetry recognises it. */
    function build4xxError(status: number) {
      const err = new Error(`HTTP ${status}`) as Error & {
        isAxiosError: boolean;
        response: { status: number };
      };
      err.isAxiosError = true;
      err.response = { status };
      return err;
    }

    beforeEach(() => {
      // Make the mocked axios.isAxiosError honour our flagged errors so
      // executeWithRetry's status-based fail-fast branch is exercised.
      mockAxios.isAxiosError = ((e: unknown): e is { response?: { status?: number } } =>
        typeof e === 'object' &&
        e !== null &&
        (e as { isAxiosError?: boolean }).isAxiosError === true) as typeof axios.isAxiosError;
    });

    it('does NOT retry on 400 Bad Request', async () => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-api-key',
        retryAttempts: 3,
        retryDelay: 10,
      });

      mockAxiosInstance.get.mockRejectedValue(build4xxError(400));

      await expect(client.searchActors({ query: 'x' })).rejects.toThrow('HTTP 400');
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on 404 Not Found', async () => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-api-key',
        retryAttempts: 3,
        retryDelay: 10,
      });

      mockAxiosInstance.get.mockRejectedValue(build4xxError(404));

      await expect(client.searchActors({ query: 'x' })).rejects.toThrow('HTTP 404');
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on 401 Unauthorized', async () => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-api-key',
        retryAttempts: 3,
        retryDelay: 10,
      });

      mockAxiosInstance.get.mockRejectedValue(build4xxError(401));

      await expect(client.searchActors({ query: 'x' })).rejects.toThrow('HTTP 401');
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
    });

    it('DOES retry on 429 Too Many Requests (documented exception)', async () => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-api-key',
        retryAttempts: 2,
        retryDelay: 10,
      });

      mockAxiosInstance.get
        .mockRejectedValueOnce(build4xxError(429))
        .mockRejectedValueOnce(build4xxError(429))
        .mockResolvedValueOnce({ data: { actors: [] } });

      const result = await client.searchActors({ query: 'x' });
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(3);
      expect(result.actors).toEqual([]);
    });

    it('DOES retry on 500 Internal Server Error', async () => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-api-key',
        retryAttempts: 1,
        retryDelay: 10,
      });

      mockAxiosInstance.get
        .mockRejectedValueOnce(build4xxError(500))
        .mockResolvedValueOnce({ data: { actors: [] } });

      const result = await client.searchActors({ query: 'x' });
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
      expect(result.actors).toEqual([]);
    });

    it('DOES retry on 503 Service Unavailable', async () => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-api-key',
        retryAttempts: 1,
        retryDelay: 10,
      });

      mockAxiosInstance.get
        .mockRejectedValueOnce(build4xxError(503))
        .mockResolvedValueOnce({ data: { actors: [] } });

      await client.searchActors({ query: 'x' });
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
    });

    it('uses exponential backoff (baseDelay * 2^(attempt-1), within jitter)', async () => {
      const baseDelay = 100;
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-api-key',
        retryAttempts: 3,
        retryDelay: baseDelay,
      });

      // Fail twice, succeed third — produces two backoff waits.
      mockAxiosInstance.get
        .mockRejectedValueOnce(new Error('transient'))
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce({ data: { actors: [] } });

      const start = Date.now();
      await client.searchActors({ query: 'x' });
      const elapsed = Date.now() - start;

      // Expected minimum delay: 100ms (attempt 1) + 200ms (attempt 2) = 300ms.
      // Allow generous upper bound for jitter + scheduler noise.
      expect(elapsed).toBeGreaterThanOrEqual(290);
      expect(elapsed).toBeLessThan(600);
    });
  });

  describe('worldData mode (no apiKey)', () => {
    it('should return empty results when no worldData', async () => {
      client = new FoundryClient({ baseUrl: 'http://localhost:30000' });

      const actors = await client.searchActors({ query: 'test' });
      expect(actors.actors).toEqual([]);
      expect(actors.total).toBe(0);

      const items = await client.searchItems({ query: 'test' });
      expect(items.items).toEqual([]);
    });

    it('should return default world info when no worldData', async () => {
      client = new FoundryClient({ baseUrl: 'http://localhost:30000' });
      const info = await client.getWorldInfo();
      expect(info.id).toBe('unknown');
      expect(info.title).toBe('Not connected');
    });

    it('should require credentials for connect in Socket.IO mode', async () => {
      client = new FoundryClient({ baseUrl: 'http://localhost:30000' });
      await expect(client.connect()).rejects.toThrow('Socket.IO mode requires');
    });

    it('should return null combat state when no worldData', () => {
      client = new FoundryClient({ baseUrl: 'http://localhost:30000' });
      expect(client.getCombatState()).toBeNull();
    });

    it('should return empty chat messages when no worldData', () => {
      client = new FoundryClient({ baseUrl: 'http://localhost:30000' });
      expect(client.getChatMessages()).toEqual([]);
    });

    it('should return empty users when no worldData', () => {
      client = new FoundryClient({ baseUrl: 'http://localhost:30000' });
      const { users, activeUsers } = client.getUsers();
      expect(users).toEqual([]);
      expect(activeUsers).toEqual([]);
    });

    it('should return empty journals when no worldData', () => {
      client = new FoundryClient({ baseUrl: 'http://localhost:30000' });
      expect(client.getJournals()).toEqual([]);
    });

    it('should return empty world search when no worldData', () => {
      client = new FoundryClient({ baseUrl: 'http://localhost:30000' });
      const results = client.searchWorld('test');
      expect(results.actors).toEqual([]);
      expect(results.items).toEqual([]);
    });

    it('should return empty summary when no worldData', () => {
      client = new FoundryClient({ baseUrl: 'http://localhost:30000' });
      expect(client.getWorldSummary()).toEqual({});
    });
  });

  describe('dice rolling', () => {
    beforeEach(() => {
      client = new FoundryClient({ baseUrl: 'http://localhost:30000' });
    });

    it('should validate dice formula', async () => {
      await expect(client.rollDice('')).rejects.toThrow('Invalid dice formula');
      await expect(client.rollDice('DROP TABLE')).rejects.toThrow('Invalid dice formula');
    });

    it('should perform fallback dice roll', async () => {
      const result = await client.rollDice('1d20+5', 'Attack roll');
      expect(result.formula).toBe('1d20+5');
      expect(result.total).toBeGreaterThanOrEqual(6);
      expect(result.total).toBeLessThanOrEqual(25);
      expect(result.reason).toBe('Attack roll');
      expect(result.timestamp).toBeDefined();
    });

    it('should perform fallback roll for multiple dice', async () => {
      const result = await client.rollDice('3d6');
      expect(result.formula).toBe('3d6');
      expect(result.total).toBeGreaterThanOrEqual(3);
      expect(result.total).toBeLessThanOrEqual(18);
    });
  });

  describe('disconnect', () => {
    it('should reset state on disconnect', async () => {
      client = new FoundryClient({ baseUrl: 'http://localhost:30000' });
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
      expect(client.hasWorldData()).toBe(false);
    });
  });

  describe('refreshWorldData listener cleanup', () => {
    /**
     * Builds a minimal mock socket that records `once`/`off`/`emit` calls and
     * lets the test trigger the registered 'world' handler manually.
     */
    function buildMockSocket() {
      const listeners = new Map<string, (...args: unknown[]) => void>();
      const socket = {
        connected: true,
        once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          listeners.set(event, handler);
          return socket;
        }),
        off: vi.fn((event: string, _handler: (...args: unknown[]) => void) => {
          listeners.delete(event);
          return socket;
        }),
        emit: vi.fn(),
        disconnect: vi.fn(),
      };
      return { socket, listeners };
    }

    it('removes the world listener on the success path', async () => {
      client = new FoundryClient({ baseUrl: 'http://localhost:30000', timeout: 50 });
      const { socket, listeners } = buildMockSocket();
      // Inject the mock socket — bypasses the real Socket.IO connect path.
      (client as unknown as { socket: typeof socket }).socket = socket;

      const refresh = client.refreshWorldData();

      // Trigger the 'world' event handler with a minimal valid WorldData payload.
      const handler = listeners.get('world');
      expect(handler).toBeDefined();
      handler?.({
        userId: 'test-user',
        actors: [],
        scenes: [],
        items: [],
        journal: [],
        messages: [],
        combats: [],
        users: [],
        activeUsers: [],
        macros: [],
        playlists: [],
        tables: [],
        folders: [],
      });

      await refresh;

      expect(socket.once).toHaveBeenCalledWith('world', expect.any(Function));
      const registeredHandler = socket.once.mock.calls[0]?.[1];
      expect(socket.off).toHaveBeenCalledWith('world', registeredHandler);
      expect(listeners.has('world')).toBe(false);
    });

    it('removes the world listener on the timeout path', async () => {
      // Short timeout so the test runs fast; never trigger the 'world' event.
      client = new FoundryClient({ baseUrl: 'http://localhost:30000', timeout: 25 });
      const { socket, listeners } = buildMockSocket();
      (client as unknown as { socket: typeof socket }).socket = socket;

      await expect(client.refreshWorldData()).rejects.toThrow('Refresh timeout');

      expect(socket.once).toHaveBeenCalledWith('world', expect.any(Function));
      const registeredHandler = socket.once.mock.calls[0]?.[1];
      expect(socket.off).toHaveBeenCalledWith('world', registeredHandler);
      expect(listeners.has('world')).toBe(false);
    });
  });
});
