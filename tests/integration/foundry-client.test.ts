import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { FoundryClient } from '../../src/foundry/client.js';

describe('FoundryClient Real Integration Tests', () => {
  let client: FoundryClient;
  const foundryUrl = process.env.FOUNDRY_URL || 'http://localhost:30001';
  const adminKey = process.env.FOUNDRY_ADMIN_KEY || 'test-admin-key-123';

  beforeEach(() => {
    // Create fresh client instance for each test to avoid state pollution
    client = new FoundryClient({
      baseUrl: foundryUrl,
      apiKey: adminKey,
      timeout: 10000,
    });
  });

  afterEach(async () => {
    if (client) {
      client.disconnect();
    }
  });

  describe('Real FoundryVTT Connection', () => {
    it('should successfully connect to real FoundryVTT instance', async () => {
      // Test actual connection to running FoundryVTT container
      await expect(client.connect()).resolves.not.toThrow();
      expect(client.isConnected()).toBe(true);
    }, 30000);

    it('should handle authentication with real API key', async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);
      
      // Try a simple API call that requires authentication
      // This tests real authentication flow, not mocked responses
      const result = await client.searchActors({ limit: 1 });
      expect(result).toBeDefined();
      expect(Array.isArray(result.actors)).toBe(true);
    }, 30000);

    it('should fail gracefully with invalid credentials', async () => {
      const invalidClient = new FoundryClient({
        baseUrl: foundryUrl,
        apiKey: 'invalid-key-12345',
        timeout: 5000,
      });

      // This should fail with real authentication error, not mock
      await expect(invalidClient.connect()).rejects.toThrow();
    }, 15000);
  });

  describe('Real API Operations', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should perform real actor search with actual FoundryVTT data', async () => {
      // Search for actors in real FoundryVTT instance
      const result = await client.searchActors({ 
        limit: 10 
      });

      // Validate real response structure (not mock data)
      expect(result).toBeDefined();
      expect(result.actors).toBeDefined();
      expect(Array.isArray(result.actors)).toBe(true);
      expect(typeof result.total).toBe('number');
      expect(typeof result.page).toBe('number');
      expect(typeof result.limit).toBe('number');

      // If actors exist, validate their real structure
      if (result.actors.length > 0) {
        const actor = result.actors[0];
        expect(actor._id).toBeDefined();
        expect(typeof actor.name).toBe('string');
        expect(typeof actor.type).toBe('string');
      }
    }, 30000);

    it('should perform real item search with actual FoundryVTT data', async () => {
      // Search for items in real FoundryVTT instance  
      const result = await client.searchItems({
        limit: 10
      });

      // Validate real response structure (not mock data)
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.total).toBe('number');

      // If items exist, validate their real structure
      if (result.items.length > 0) {
        const item = result.items[0];
        expect(item._id).toBeDefined();
        expect(typeof item.name).toBe('string');
        expect(typeof item.type).toBe('string');
      }
    }, 30000);

    it('should handle real search queries with filters', async () => {
      // Test search with real query parameters
      const result = await client.searchActors({
        query: 'a', // Search for actors with 'a' in name
        limit: 5
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result.actors)).toBe(true);
      expect(result.limit).toBe(5);

      // All returned actors should match the query (if any exist)
      if (result.actors.length > 0) {
        result.actors.forEach(actor => {
          expect(actor.name.toLowerCase()).toContain('a');
        });
      }
    }, 30000);
  });

  describe('Real WebSocket Communication', () => {
    it('should establish real WebSocket connection when no API key provided', async () => {
      const wsClient = new FoundryClient({
        baseUrl: foundryUrl,
        timeout: 10000,
      });

      try {
        await wsClient.connect();
        expect(wsClient.isConnected()).toBe(true);

        // Test real WebSocket message sending
        const testMessage = { 
          type: 'ping', 
          data: { timestamp: Date.now() } 
        };
        
        expect(() => {
          wsClient.sendMessage(testMessage);
        }).not.toThrow();
      } finally {
        wsClient.disconnect();
      }
    }, 30000);
  });

  describe('Real Error Scenarios', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should handle real network timeouts', async () => {
      // Create client with very short timeout
      const timeoutClient = new FoundryClient({
        baseUrl: foundryUrl,
        apiKey: adminKey,
        timeout: 1, // 1ms timeout to force failure
        retryAttempts: 0, // Disable retries
      });

      await timeoutClient.connect();

      await expect(timeoutClient.searchActors({ limit: 1 }))
        .rejects.toThrow();

      timeoutClient.disconnect();
    }, 15000);

    it('should handle malformed search parameters', async () => {
      // Test with invalid parameters that would cause real API errors
      const result = await client.searchActors({
        limit: -1, // Invalid limit
      });

      // Real FoundryVTT should handle invalid parameters gracefully
      expect(result).toBeDefined();
      expect(Array.isArray(result.actors)).toBe(true);
    }, 15000);
  });

  describe('Real Connection Lifecycle', () => {
    it('should handle real connection-disconnection cycles', async () => {
      // Test multiple connect/disconnect cycles with real FoundryVTT
      for (let i = 0; i < 3; i++) {
        await client.connect();
        expect(client.isConnected()).toBe(true);

        // Perform real operation
        const result = await client.searchActors({ limit: 1 });
        expect(result).toBeDefined();

        client.disconnect();
        expect(client.isConnected()).toBe(false);
      }
    }, 60000);
  });

  describe('Real API Response Validation', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should validate real FoundryVTT actor response structure', async () => {
      const result = await client.searchActors({ limit: 1 });

      // Contract test: Validate that real API matches our expected schema
      expect(result).toMatchObject({
        actors: expect.any(Array),
        total: expect.any(Number),
        page: expect.any(Number),
        limit: expect.any(Number),
      });

      if (result.actors.length > 0) {
        const actor = result.actors[0];
        expect(actor).toMatchObject({
          _id: expect.any(String),
          name: expect.any(String),
          type: expect.any(String),
        });
      }
    }, 30000);

    it('should validate real FoundryVTT item response structure', async () => {
      const result = await client.searchItems({ limit: 1 });

      // Contract test: Validate that real API matches our expected schema
      expect(result).toMatchObject({
        items: expect.any(Array),
        total: expect.any(Number),
        page: expect.any(Number),
        limit: expect.any(Number),
      });

      if (result.items.length > 0) {
        const item = result.items[0];
        expect(item).toMatchObject({
          _id: expect.any(String),
          name: expect.any(String),
          type: expect.any(String),
        });
      }
    }, 30000);
  });
});