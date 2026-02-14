import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

// Mock external dependencies
vi.mock('axios');
vi.mock('socket.io-client');
vi.mock('../foundry/auth.js', () => ({
  authenticateFoundry: vi.fn().mockResolvedValue({ session: 'test-session', userId: 'test-user-id' }),
}));
vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('../config/index.js', () => ({
  config: {
    logLevel: 'info',
  },
}));

const { FoundryClient } = await import('../foundry/client.js');
const { logger } = await import('../utils/logger.js');

const mockAxios = vi.mocked(axios);

describe('Integration Tests', () => {
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
    mockAxios.default = mockAxios;
  });

  afterEach(() => {
    if (client) {
      client.disconnect();
    }
  });

  describe('FoundryClient Integration', () => {
    it('should initialize client with proper configuration flow', () => {
      expect(() => {
        client = new FoundryClient({
          baseUrl: 'http://localhost:30000',
          apiKey: 'test-key',
          timeout: 5000,
        });
      }).not.toThrow();

      expect(client).toBeDefined();
    });

    it('should handle connection lifecycle', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: { status: 'connected' } });

      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-key',
      });

      await expect(client.connect()).resolves.not.toThrow();
      expect(client.isConnected()).toBe(true);

      client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it('should handle API operations with proper error handling', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { status: 'connected' } })
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce({
          data: {
            actors: [{ _id: '1', name: 'Test Actor', type: 'character' }],
          },
        });

      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-key',
        retryAttempts: 2,
        retryDelay: 100,
      });

      await client.connect();

      const result = await client.searchActors({ query: 'Test' });

      expect(result.actors).toHaveLength(1);
      expect(result.actors[0].name).toBe('Test Actor');
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(3);
    });
  });

  describe('Configuration and Logger Integration', () => {
    it('should use logger throughout the system', () => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
      });

      expect(logger).toBeDefined();
    });

    it('should handle invalid configurations gracefully', () => {
      expect(() => {
        client = new FoundryClient({ baseUrl: '' });
      }).toThrow('baseUrl is required and cannot be empty');
    });
  });

  describe('Data Flow Integration', () => {
    it('should process complete actor search workflow', async () => {
      const mockActorData = {
        actors: [
          {
            _id: 'actor-1',
            name: 'Gandalf',
            type: 'npc',
            level: 20,
            hp: { value: 165, max: 165 },
            abilities: {
              str: { value: 10, mod: 0 },
              int: { value: 20, mod: 5 },
            },
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      };

      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { status: 'connected' } })
        .mockResolvedValueOnce({ data: mockActorData });

      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-key',
      });

      await client.connect();

      const searchParams = { query: 'Gandalf', type: 'npc', limit: 10 };
      const result = await client.searchActors(searchParams);

      expect(result.actors).toHaveLength(1);
      expect(result.actors[0].name).toBe('Gandalf');
      expect(result.actors[0].abilities?.int?.mod).toBe(5);
      expect(result.total).toBe(1);
    });

    it('should handle complex item search with filtering', async () => {
      const mockItemData = {
        items: [
          {
            _id: 'item-1',
            name: 'Flame Tongue',
            type: 'weapon',
            rarity: 'rare',
            damage: { parts: [['1d8', 'slashing'], ['2d6', 'fire']] },
            price: { value: 5000, denomination: 'gp' },
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      };

      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { status: 'connected' } })
        .mockResolvedValueOnce({ data: mockItemData });

      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-key',
      });

      await client.connect();

      const searchParams = { query: 'Flame', type: 'weapon', rarity: 'rare', limit: 10 };
      const result = await client.searchItems(searchParams);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('Flame Tongue');
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle cascading failures gracefully', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { status: 'connected' } })
        .mockRejectedValue(new Error('Service unavailable'));

      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-key',
        retryAttempts: 2,
        retryDelay: 10,
      });

      await client.connect();

      await expect(client.searchActors({ query: 'test' })).rejects.toThrow('Service unavailable');
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(4);
    });

    it('should maintain system stability after errors', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { status: 'connected' } })
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({ data: { actors: [] } })
        .mockResolvedValueOnce({ data: { items: [] } });

      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-key',
        retryAttempts: 1,
      });

      await client.connect();

      const actorResult = await client.searchActors({ query: 'test' });
      expect(actorResult.actors).toEqual([]);

      const itemResult = await client.searchItems({ query: 'test' });
      expect(itemResult.items).toEqual([]);

      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(4);
    });
  });
});
