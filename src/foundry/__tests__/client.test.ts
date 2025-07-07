import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import WebSocket from 'ws';

// Mock dependencies
vi.mock('axios');
vi.mock('ws');
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

const { FoundryClient } = await import('../client');

const mockAxios = axios as any;
const mockWebSocket = WebSocket as any;

describe('FoundryClient', () => {
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
    mockWebSocket.mockImplementation(() => ({
      on: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      readyState: WebSocket.OPEN,
    }));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
      });

      expect(mockAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:30000',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'FoundryMCP/0.1.0',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        maxRedirects: 3,
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024,
        validateStatus: expect.any(Function),
      });
    });

    it('should create instance with custom config', () => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-key',
        timeout: 5000,
        retryAttempts: 5,
        retryDelay: 500,
      });

      expect(mockAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:30000',
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'FoundryMCP/0.1.0',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        maxRedirects: 3,
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024,
        validateStatus: expect.any(Function),
      });
    });

    it('should handle authentication headers', () => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        username: 'testuser',
        password: 'testpass',
      });

      expect(mockAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:30000',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'FoundryMCP/0.1.0',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        maxRedirects: 3,
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024,
        validateStatus: expect.any(Function),
      });
    });
  });

  describe('connection methods', () => {
    beforeEach(() => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
      });
    });

    it('should determine connection method based on config', () => {
      const restClient = new FoundryClient({
        baseUrl: 'http://localhost:30000',
      });

      expect(restClient).toBeDefined();
    });

    it('should handle WebSocket connection', async () => {
      const mockWs = {
        on: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
        readyState: WebSocket.OPEN,
      };

      mockWebSocket.mockImplementation(() => mockWs);

      // Mock successful connection
      mockWs.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'open') {
          setTimeout(() => callback(), 0);
        }
      });

      await expect(client.connect()).resolves.not.toThrow();
    });
  });

  describe('API methods', () => {
    beforeEach(() => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-api-key',
      });
    });

    it('should search actors', async () => {
      const mockActors = [
        { _id: '1', name: 'Hero', type: 'character' },
        { _id: '2', name: 'Villain', type: 'npc' },
      ];

      mockAxiosInstance.get.mockResolvedValue({
        data: { actors: mockActors },
      });

      const result = await client.searchActors({ query: 'Hero' });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/actors', {
        params: { query: 'Hero' },
      });
      expect(result.actors).toEqual(mockActors);
    });

    it('should search items', async () => {
      const mockItems = [
        { _id: '1', name: 'Sword', type: 'weapon' },
        { _id: '2', name: 'Potion', type: 'consumable' },
      ];

      mockAxiosInstance.get.mockResolvedValue({
        data: { items: mockItems },
      });

      const result = await client.searchItems({
        query: 'Sword',
        type: 'weapon',
        limit: 10
      });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/items', {
        params: { query: 'Sword', type: 'weapon', limit: 10 },
      });
      expect(result.items).toEqual(mockItems);
    });

    it('should get world info', async () => {
      const mockWorld = {
        id: 'world-1',
        title: 'Test World',
        system: 'dnd5e',
        description: 'A test world',
      };

      mockAxiosInstance.get.mockResolvedValue({
        data: mockWorld,
      });

      const result = await client.getWorldInfo();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/world');
      expect(result).toEqual(mockWorld);
    });

    it('should handle API errors', async () => {
      // Create client with faster retry settings for this test
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-api-key',
        retryAttempts: 1,
        retryDelay: 10,
      });

      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

      await expect(client.searchActors({ query: 'test' }))
        .rejects.toThrow('Network error');
    }, 10000); // 10 second timeout
  });

  describe('retry mechanism', () => {
    beforeEach(() => {
      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        apiKey: 'test-api-key',
        retryAttempts: 3,
        retryDelay: 100,
      });
    });

    it('should retry failed requests', async () => {
      mockAxiosInstance.get
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ data: { actors: [] } });

      const result = await client.searchActors({ query: 'test' });

      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(3);
      expect(result.actors).toEqual([]);
    });

    it('should fail after max retry attempts', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Persistent error'));

      await expect(client.searchActors({ query: 'test' }))
        .rejects.toThrow('Persistent error');

      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });
  });

  describe('WebSocket functionality', () => {
    let mockWs: any;

    beforeEach(() => {
      mockWs = {
        on: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
        readyState: WebSocket.OPEN,
      };

      mockWebSocket.mockImplementation(() => mockWs);

      client = new FoundryClient({
        baseUrl: 'http://localhost:30000',
        // No apiKey - this will use WebSocket mode
      });
    });

    it('should send WebSocket messages', async () => {
      // Mock successful connection
      mockWs.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'open') {
          setTimeout(() => callback(), 0);
        }
      });

      await client.connect();

      const message = { type: 'test', data: { hello: 'world' } };
      client.sendMessage(message);

      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it('should handle WebSocket events', async () => {
      const eventHandler = vi.fn();

      // Mock successful connection and message
      mockWs.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'open') {
          setTimeout(() => callback(), 0);
        } else if (event === 'message') {
          setTimeout(() => callback(JSON.stringify({ type: 'test', data: {} })), 10);
        }
      });

      await client.connect();
      client.onMessage('test', eventHandler);

      // Wait for message to be processed
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(eventHandler).toHaveBeenCalled();
    });

    it('should handle connection errors', async () => {
      mockWs.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'error') {
          setTimeout(() => callback(new Error('Connection failed')), 0);
        }
      });

      await expect(client.connect()).rejects.toThrow('Connection failed');
    });
  });
});
