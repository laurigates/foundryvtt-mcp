import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock external dependencies
vi.mock('axios');
vi.mock('socket.io-client');
vi.mock('../foundry/auth.js', () => ({
  authenticateFoundry: vi
    .fn()
    .mockResolvedValue({ session: 'test-session', userId: 'test-user-id' }),
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
      mockAxiosInstance.get.mockResolvedValue({
        data: { success: true, data: { id: 'w', title: 'World' } },
      });

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
        .mockResolvedValueOnce({ data: { success: true, data: { id: 'w', title: 'World' } } })
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: [{ id: 'actoraaaaaaaaaaa', name: 'Test Actor', type: 'character' }],
            total: 1,
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
      // The module's `{ success, data }` envelope around `formatActorSummary` (#310).
      const mockActorData = {
        success: true,
        data: [
          {
            id: 'actor-1',
            name: 'Gandalf',
            type: 'npc',
            level: 20,
            hp: { current: 165, max: 165 },
            ac: 15,
          },
        ],
        total: 1,
        query: { query: 'Gandalf', type: 'npc', limit: 10 },
      };

      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { success: true, data: { id: 'w', title: 'World' } } })
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
      expect(result.actors[0].hp).toEqual({ value: 165, max: 165 });
      expect(result.actors[0].ac).toEqual({ value: 15 });
      expect(result.total).toBe(1);
    });

    it('should handle complex item search with filtering', async () => {
      // The module's `{ success, data }` envelope around `formatItemSummary` (#310).
      const mockItemData = {
        success: true,
        data: [
          {
            id: 'item-1',
            name: 'Flame Tongue',
            type: 'weapon',
            rarity: 'rare',
            cost: { value: 5000, denomination: 'gp' },
          },
        ],
        total: 1,
        query: { query: 'Flame', type: 'weapon', rarity: 'rare', limit: 10 },
      };

      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { success: true, data: { id: 'w', title: 'World' } } })
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
        .mockResolvedValueOnce({ data: { success: true, data: { id: 'w', title: 'World' } } })
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
        .mockResolvedValueOnce({ data: { success: true, data: { id: 'w', title: 'World' } } })
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({ data: { success: true, data: [], total: 0 } })
        .mockResolvedValueOnce({ data: { success: true, data: [], total: 0 } });

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
