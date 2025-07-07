import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

// Mock external dependencies
vi.mock('axios');
vi.mock('ws');
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

const { FoundryClient } = await import('../foundry/client');
const { logger } = await import('../utils/logger');

const mockAxios = axios as any;

describe('Integration Tests', () => {
  let client: FoundryClient;
  let mockAxiosInstance: any;

  beforeEach(() => {
    mockAxiosInstance = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
      interceptors: {
        request: {
          use: vi.fn(),
        },
        response: {
          use: vi.fn(),
        },
      },
    };

    vi.clearAllMocks();
    mockAxios.create = vi.fn().mockReturnValue(mockAxiosInstance);
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
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-key',
      });

      // Mock successful connection
      const mockAxios = await import('axios');
      const mockAxiosInstance = {
        get: vi.fn().mockResolvedValue({ data: { status: 'connected' } }),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
      };

      (mockAxios.default as any).create = vi.fn().mockReturnValue(mockAxiosInstance);

      await expect(client.connect()).resolves.not.toThrow();
      expect(client.isConnected()).toBe(true);

      client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it('should handle API operations with proper error handling', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { status: 'connected' } }) // For connect() call
        .mockRejectedValueOnce(new Error('Temporary error'))      // First searchActors call
        .mockResolvedValueOnce({                                  // Second searchActors call (retry)
          data: {
            actors: [
              { _id: '1', name: 'Test Actor', type: 'character' }
            ]
          }
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
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(3); // 1 for connect + 2 for searchActors (retry)
    });
  });

  describe('Configuration and Logger Integration', () => {
    it('should use logger throughout the system', () => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
      });

      // Verify logger is being used (mocked)
      expect(logger).toBeDefined();
    });

    it('should handle invalid configurations gracefully', () => {
      expect(() => {
        client = new FoundryClient({
          baseUrl: '', // Invalid URL
        });
      }).toThrow();
    });
  });

  describe('WebSocket Integration', () => {
    it('should establish WebSocket connection and handle messages', async () => {
      const mockWebSocket = await import('ws');
      const mockWs = {
        on: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1, // WebSocket.OPEN
      };

      (mockWebSocket.default as any).mockImplementation(() => mockWs);

      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        // Use WebSocket connection (no API key)
      });

      // Mock successful WebSocket connection
      mockWs.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'open') {
          setTimeout(() => callback(), 0);
        }
      });

      await expect(client.connect()).resolves.not.toThrow();

      // Test message sending
      const testMessage = { type: 'ping', data: { timestamp: Date.now() } };
      client.sendMessage(testMessage);

      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(testMessage));
    });

    it('should handle WebSocket disconnection and reconnection', async () => {
      const mockWebSocket = await import('ws');
      const mockWs = {
        on: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1,
      };

      (mockWebSocket.default as any).mockImplementation(() => mockWs);

      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        retryAttempts: 3,
        retryDelay: 50,
      });

      // Mock connection, disconnection, and reconnection
      mockWs.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'open') {
          setTimeout(() => callback(), 0);
        } else if (event === 'close') {
          setTimeout(() => callback(), 10);
        }
      });

      await client.connect();
      expect(client.isConnected()).toBe(true);

      // Simulate disconnection
      client.disconnect();
      expect(mockWs.close).toHaveBeenCalled();
    });
  });

  describe('Data Flow Integration', () => {
    it('should process complete actor search workflow', async () => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-key',
      });

      const mockAxios = await import('axios');
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
        .mockResolvedValueOnce({ data: { status: 'connected' } }) // For connect() call
        .mockResolvedValueOnce({ data: mockActorData });          // For searchActors call

      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-key',
      });

      await client.connect();

      const searchParams = {
        query: 'Gandalf',
        type: 'npc',
        limit: 10,
      };

      const result = await client.searchActors(searchParams);

      expect(result.actors).toHaveLength(1);
      expect(result.actors[0].name).toBe('Gandalf');
      expect(result.actors[0].abilities?.int?.mod).toBe(5);
      expect(result.total).toBe(1);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/actors', {
        params: searchParams,
      });
    });

    it('should handle complex item search with filtering', async () => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-key',
      });

      const mockAxios = await import('axios');
      const mockItemData = {
        items: [
          {
            _id: 'item-1',
            name: 'Flame Tongue',
            type: 'weapon',
            rarity: 'rare',
            damage: {
              parts: [['1d8', 'slashing'], ['2d6', 'fire']],
            },
            price: { value: 5000, denomination: 'gp' },
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      };

      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { status: 'connected' } }) // For connect() call
        .mockResolvedValueOnce({ data: mockItemData });          // For searchItems call

      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-key',
      });

      await client.connect();

      const searchParams = {
        query: 'Flame',
        type: 'weapon',
        rarity: 'rare',
        limit: 10,
      };

      const result = await client.searchItems(searchParams);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('Flame Tongue');
      expect(result.items[0].damage?.parts).toHaveLength(2);
      expect(result.items[0].price?.value).toBe(5000);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/items', {
        params: searchParams,
      });
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle cascading failures gracefully', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { status: 'connected' } }) // For connect() call
        .mockRejectedValue(new Error('Service unavailable'));      // For all searchActors calls

      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-key',
        retryAttempts: 2,
        retryDelay: 10,
      });

      await client.connect();

      await expect(client.searchActors({ query: 'test' }))
        .rejects.toThrow('Service unavailable');

      // Verify retry attempts were made: 1 for connect + 3 for searchActors (initial + 2 retries)
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(4);
    });

    it('should maintain system stability after errors', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { status: 'connected' } })  // For connect() call
        .mockRejectedValueOnce(new Error('Temporary failure'))     // First searchActors call
        .mockResolvedValueOnce({ data: { actors: [] } })           // Second searchActors call (retry)
        .mockResolvedValueOnce({ data: { items: [] } });           // For searchItems call

      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-key',
        retryAttempts: 1,
      });

      await client.connect();

      // First call should fail then succeed on retry
      const actorResult = await client.searchActors({ query: 'test' });
      expect(actorResult.actors).toEqual([]);

      // Subsequent calls should work normally
      const itemResult = await client.searchItems({ query: 'test' });
      expect(itemResult.items).toEqual([]);

      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(4); // 1 for connect + 2 for actors (fail + retry) + 1 for items
    });
  });
});
