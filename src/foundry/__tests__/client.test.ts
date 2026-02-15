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
});
