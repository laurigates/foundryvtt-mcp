/**
 * @fileoverview FoundryVTT client for API communication and WebSocket connections
 *
 * This module provides a comprehensive client for interacting with FoundryVTT instances
 * through both REST API (via optional module) and WebSocket connections.
 *
 * @version 0.1.0
 * @author FoundryVTT MCP Team
 */

import axios, { AxiosInstance, AxiosResponse, AxiosRequestConfig } from 'axios';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { cache, CacheKeys } from '../utils/cache-instance.js';
import { FoundryActor, FoundryScene, FoundryWorld, DiceRoll, ActorSearchResult, ItemSearchResult } from './types.js';

/**
 * Configuration interface for FoundryVTT client connection settings
 *
 * @interface FoundryClientConfig
 * @example
 * ```typescript
 * const config: FoundryClientConfig = {
 *   baseUrl: 'http://localhost:30000',
 *   apiKey: 'your-api-key',
 *   timeout: 10000
 * };
 * ```
 */
export interface FoundryClientConfig {
  /** Base URL of the FoundryVTT server (e.g., 'http://localhost:30000') */
  baseUrl: string;
  /** Whether to use the REST API module (optional, default: false) */
  useRestModule?: boolean;
  /** API key for REST API module authentication (optional) */
  apiKey?: string;
  /** Username for basic authentication (optional) */
  username?: string;
  /** Password for basic authentication (optional) */
  password?: string;
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number;
  /** Number of retry attempts for failed requests (default: 3) */
  retryAttempts?: number;
  /** Delay between retry attempts in milliseconds (default: 1000) */
  retryDelay?: number;
  /** Custom WebSocket path (default: '/socket.io') */
  socketPath?: string;
}

/**
 * Parameters for searching actors in FoundryVTT
 *
 * @interface SearchActorsParams
 * @example
 * ```typescript
 * const params: SearchActorsParams = {
 *   query: 'Gandalf',
 *   type: 'npc',
 *   limit: 10
 * };
 * ```
 */
export interface SearchActorsParams {
  /** Search query string to match against actor names */
  query?: string;
  /** Actor type filter (e.g., 'character', 'npc') */
  type?: string;
  /** Maximum number of results to return */
  limit?: number;
}

/**
 * Parameters for searching items in FoundryVTT
 *
 * @interface SearchItemsParams
 * @example
 * ```typescript
 * const params: SearchItemsParams = {
 *   query: 'sword',
 *   type: 'weapon',
 *   rarity: 'rare',
 *   limit: 20
 * };
 * ```
 */
export interface SearchItemsParams {
  /** Search query string to match against item names */
  query?: string;
  /** Item type filter (e.g., 'weapon', 'armor', 'consumable') */
  type?: string;
  /** Item rarity filter (e.g., 'common', 'uncommon', 'rare') */
  rarity?: string;
  /** Maximum number of results to return */
  limit?: number;
}

/**
 * WebSocket message interface for validation
 *
 * @interface WebSocketMessage
 */
export interface WebSocketMessage {
  /** Message type identifier */
  type: string;
  /** Optional message data payload */
  data?: unknown;
}

/**
 * Client for communicating with FoundryVTT instances
 *
 * This class provides methods for interacting with FoundryVTT through both REST API
 * and WebSocket connections. It supports dice rolling, actor/item searching,
 * scene management, and real-time updates.
 *
 * @class FoundryClient
 * @example
 * ```typescript
 * const client = new FoundryClient({
 *   baseUrl: 'http://localhost:30000',
 *   apiKey: 'your-api-key'
 * });
 *
 * await client.connect();
 * const actors = await client.searchActors({ query: 'Hero' });
 * const diceResult = await client.rollDice('1d20+5', 'Attack roll');
 * ```
 */
/**
 * Maximum WebSocket message size in bytes to prevent JSON bomb attacks
 */
const MAX_WEBSOCKET_MESSAGE_SIZE = 1024 * 1024; // 1MB

/**
 * Validates if an object is a valid WebSocket message
 *
 * @param obj - Object to validate
 * @returns True if the object is a valid WebSocket message
 */
function isValidWebSocketMessage(obj: unknown): obj is WebSocketMessage {
  return typeof obj === 'object' && 
         obj !== null && 
         'type' in obj &&
         typeof (obj as Record<string, unknown>).type === 'string' && 
         ((obj as Record<string, unknown>).type as string).length > 0 &&
         ((obj as Record<string, unknown>).type as string).length < 100; // Prevent extremely long type strings
}

export class FoundryClient extends EventEmitter {
  private http: AxiosInstance;
  private ws: WebSocket | null = null;
  private config: FoundryClientConfig;
  private sessionToken?: string;
  private _isConnected = false;
  private connectionMethod: 'rest' | 'websocket' | 'hybrid' = 'websocket';

  /**
   * Creates a new FoundryClient instance
   *
   * @param config - Configuration object for the client
   * @example
   * ```typescript
   * const client = new FoundryClient({
   *   baseUrl: 'http://localhost:30000',
   *   apiKey: 'your-api-key',
   *   timeout: 15000
   * });
   * ```
   */
  constructor(config: FoundryClientConfig) {
    super(); // Call EventEmitter constructor
    
    // Validate required configuration
    if (!config.baseUrl || config.baseUrl.trim() === '') {
      throw new Error('baseUrl is required and cannot be empty');
    }

    // Basic URL validation
    try {
      new URL(config.baseUrl);
    } catch (error) {
      throw new Error(`Invalid baseUrl: ${config.baseUrl}`);
    }
    
    this.config = {
      timeout: 10000,
      retryAttempts: 3,
      retryDelay: 1000,
      socketPath: '/socket.io',
      useRestModule: false,
      ...config,
    };

    // Determine connection method based on configuration
    if (this.config.useRestModule) {
      this.connectionMethod = 'rest';
    } else if (this.config.username && this.config.password) {
      this.connectionMethod = 'hybrid'; // WebSocket + potential auth
    } else {
      this.connectionMethod = 'websocket';
    }

    this.http = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FoundryMCP/0.1.0',
        'Accept-Encoding': 'gzip, deflate, br', // Enable compression
      },
      // HTTP connection pooling and performance optimizations
      maxRedirects: 3,
      maxContentLength: 50 * 1024 * 1024, // 50MB limit
      maxBodyLength: 50 * 1024 * 1024,    // 50MB limit
      validateStatus: (status) => status >= 200 && status < 300, // Only 2xx responses are successful
    });

    this.setupHttpInterceptors();
    logger.info(`FoundryVTT client initialized (${this.connectionMethod} mode)`);
  }

  /**
   * Sets up HTTP request and response interceptors for authentication and error handling
   * @private
   */
  private setupHttpInterceptors(): void {
    // Request interceptor for authentication
    this.http.interceptors.request.use((config) => {
      if (this.config.apiKey) {
        // Use x-api-key header for local REST API module
        config.headers['x-api-key'] = this.config.apiKey;
      } else if (this.sessionToken) {
        config.headers.Authorization = `Bearer ${this.sessionToken}`;
      }
      return config;
    });

    // Response interceptor for error handling
    this.http.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          logger.warn('Authentication failed, connection may need to be re-established');
          this._isConnected = false;
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Tests the connection to FoundryVTT server
   *
   * @returns Promise that resolves to true if connection is successful
   * @throws {Error} If connection fails
   * @example
   * ```typescript
   * try {
   *   const isConnected = await client.testConnection();
   *   console.log('Connected:', isConnected);
   * } catch (error) {
   *   console.error('Connection failed:', error);
   * }
   * ```
   */
  async testConnection(): Promise<boolean> {
    try {
      logger.debug('Testing connection to FoundryVTT...');

      // Try to authenticate if we have credentials
      if (this.config.username && this.config.password) {
        await this.authenticate();
      }

      // Test basic API endpoint
      const response = await this.http.get('/');
      logger.debug('Connection test successful', { status: response.status });
      return true;
    } catch (error) {
      logger.error('Failed to connect to FoundryVTT:', error);
      throw error;
    }
  }

  /**
   * Handles incoming WebSocket messages from FoundryVTT
   *
   * @param message - The WebSocket message object
   * @private
   */
  private handleWebSocketMessage(message: WebSocketMessage): void {
    logger.debug('WebSocket message received:', message);

    // Emit events for message handlers
    try {
      // Emit specific message type event
      this.emit(`message:${message.type}`, message.data);
      
      // Emit general message event
      this.emit('message', message);
    } catch (error) {
      logger.error('Error emitting WebSocket message events:', error);
    }

    // Handle built-in message types
    switch (message.type) {
      case 'combatUpdate':
        logger.info('Combat state updated');
        break;
      case 'actorUpdate':
        logger.info('Actor updated:', (message.data as Record<string, unknown>)?.name);
        break;
      case 'sceneUpdate':
        logger.info('Scene updated:', (message.data as Record<string, unknown>)?.name);
        break;
      default:
        logger.debug('Unknown WebSocket message type:', message.type);
    }
  }

  /**
   * Disconnects from FoundryVTT server
   *
   * Closes WebSocket connection and resets connection state.
   *
   * @returns Promise that resolves when disconnection is complete
   * @example
   * ```typescript
   * await client.disconnect();
   * console.log('Disconnected from FoundryVTT');
   * ```
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      // Clean up all event listeners if the method exists
      if (typeof this.ws.removeAllListeners === 'function') {
        this.ws.removeAllListeners();
      }
      this.ws.close();
      this.ws = null;
    }
    
    // Clean up all EventEmitter listeners
    this.removeAllListeners();
    
    this._isConnected = false;
    logger.info('FoundryVTT client disconnected');
  }

  /**
   * Checks if client is currently connected to FoundryVTT
   *
   * @returns True if connected, false otherwise
   * @example
   * ```typescript
   * if (client.isConnected()) {
   *   console.log('Client is connected');
   * }
   * ```
   */
  isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Executes an HTTP request with retry logic
   *
   * @private
   * @param operation - Function that returns a Promise for the HTTP operation
   * @returns Promise that resolves to the operation result
   * @throws {Error} If all retry attempts fail
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    const maxAttempts = (this.config.retryAttempts || 3) + 1; // Include initial attempt
    const baseDelay = this.config.retryDelay || 1000;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry client errors (4xx) except for 429 (rate limiting)
        if (axios.isAxiosError(error)) {
          if (error.response?.status && error.response.status >= 400 && error.response.status < 500 && error.response.status !== 429) {
            throw lastError;
          }
        }
        
        logger.debug(`Request attempt ${attempt} failed:`, error);
        
        // If this was the last attempt, throw the error
        if (attempt === maxAttempts) {
          throw lastError;
        }
        
        // Exponential backoff with jitter
        const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 0.1 * exponentialDelay;
        const finalDelay = exponentialDelay + jitter;
        
        logger.debug(`Retrying in ${Math.round(finalDelay)}ms (attempt ${attempt + 1}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, finalDelay));
      }
    }
    
    throw lastError || new Error('Request failed after all retry attempts');
  }

  /**
   * Establishes connection to FoundryVTT server
   *
   * Uses either REST API or WebSocket connection based on configuration.
   *
   * @returns Promise that resolves when connection is established
   * @throws {Error} If connection fails
   * @example
   * ```typescript
   * await client.connect();
   * console.log('Connected to FoundryVTT');
   * ```
   */
  async connect(): Promise<void> {
    if (this.config.apiKey) {
      // For local REST API module, test the connection
      try {
        await this.http.get('/api/status');
        this._isConnected = true;
        logger.info('Connected to FoundryVTT via local REST API module');
      } catch (error) {
        logger.error('Failed to connect via local REST API module:', error);
        throw error;
      }
    } else {
      // Use WebSocket connection
      await this.connectWebSocket();
      this._isConnected = true;
    }
  }

  /**
   * Sends a message via WebSocket connection
   *
   * @param message - Message object to send
   * @example
   * ```typescript
   * client.sendMessage({
   *   type: 'chat',
   *   content: 'Hello from MCP!'
   * });
   * ```
   */
  sendMessage(message: WebSocketMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      logger.warn('Cannot send message: WebSocket not connected');
    }
  }

  /**
   * Registers a message handler for specific WebSocket message types
   *
   * @param type - Message type to handle
   * @param handler - Function to call when message is received
   * @example
   * ```typescript
   * client.onMessage('combatUpdate', (data) => {
   *   console.log('Combat updated:', data);
   * });
   * ```
   */
  onMessage(type: string, handler: (...args: any[]) => void): void {
    this.on(`message:${type}`, handler);
  }

  /**
   * Remove a message handler for a specific type
   * 
   * @param type - Message type to stop listening for
   * @param handler - Optional specific handler to remove
   */
  offMessage(type: string, handler?: (...args: any[]) => void): void {
    if (handler) {
      this.off(`message:${type}`, handler);
    } else {
      this.removeAllListeners(`message:${type}`);
    }
  }

  /**
   * Authenticates with FoundryVTT using username and password
   *
   * @private
   * @returns Promise that resolves when authentication is complete
   * @throws {Error} If authentication fails or credentials are missing
   */
  private async authenticate(): Promise<void> {
    if (!this.config.username || !this.config.password) {
      throw new Error('Username and password required for authentication');
    }

    try {
      const response = await this.http.post('/api/auth', {
        username: this.config.username,
        password: this.config.password,
      });

      this.sessionToken = response.data.token;
      logger.info('Successfully authenticated with FoundryVTT');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown authentication error';
      logger.error(`Authentication failed: ${errorMessage}`);
      throw new Error('Failed to authenticate with FoundryVTT');
    }
  }

  /**
   * Rolls dice using FoundryVTT's dice system
   *
   * @param formula - Dice formula in standard notation (e.g., '1d20+5', '3d6')
   * @param reason - Optional reason for the roll
   * @returns Promise resolving to dice roll result
   * @example
   * ```typescript
   * const result = await client.rollDice('1d20+5', 'Attack roll');
   * console.log(`Rolled ${result.total} (${result.breakdown})`);
   * ```
   */
  async rollDice(formula: string, reason?: string): Promise<DiceRoll> {
    // Validate dice formula to prevent injection attacks
    const DICE_FORMULA_REGEX = /^[0-9d\s+\-()]+$/;
    if (!formula || formula.length > 100 || !DICE_FORMULA_REGEX.test(formula)) {
      throw new Error(`Invalid dice formula: ${formula}`);
    }

    try {
      logger.debug('Rolling dice', { formula, reason });

      if (this.config.useRestModule) {
        // Use REST API module if available
        const response = await this.http.post('/api/dice/roll', {
          formula,
          flavor: reason,
        });

        const result: DiceRoll = {
          formula,
          total: response.data.total,
          breakdown: response.data.terms?.map((term: { results?: number[] }) => term.results?.join(', ')).join(' + ') || formula,
          timestamp: new Date().toISOString(),
        };
        if (reason) {
          result.reason = reason;
        }
        return result;
      } else {
        // Use fallback dice rolling
        return this.fallbackDiceRoll(formula, reason);
      }
    } catch (error) {
      logger.warn('REST API dice roll failed, using fallback:', error);
      return this.fallbackDiceRoll(formula, reason);
    }
  }

  /**
   * Performs fallback dice rolling when REST API is unavailable
   *
   * @private
   * @param formula - Dice formula to roll
   * @param reason - Optional reason for the roll
   * @returns Dice roll result
   */
  private fallbackDiceRoll(formula: string, reason?: string): DiceRoll {
    // Basic dice roll parsing (1d20, 2d6+3, etc.)
    const diceRegex = /(\d+)d(\d+)([+\-]\d+)?/g;
    let total = 0;
    const breakdown: string[] = [];

    let match;
    while ((match = diceRegex.exec(formula)) !== null) {
      const [, numDice, numSides, modifier] = match;
      const diceCount = parseInt(numDice || '1');
      const sides = parseInt(numSides || '6');
      const mod = modifier ? parseInt(modifier) : 0;

      const rolls: number[] = [];
      for (let i = 0; i < diceCount; i++) {
        rolls.push(Math.floor(Math.random() * sides) + 1);
      }

      const rollSum = rolls.reduce((sum, roll) => sum + roll, 0) + mod;
      total += rollSum;

      breakdown.push(`${rolls.join(', ')}${mod !== 0 ? ` ${modifier}` : ''} = ${rollSum}`);
    }

    const result: DiceRoll = {
      formula,
      total,
      breakdown: breakdown.join(' | '),
      timestamp: new Date().toISOString(),
    };
    if (reason) {
      result.reason = reason;
    }
    return result;
  }

  /**
   * Searches for actors in FoundryVTT
   *
   * @param params - Search parameters
   * @returns Promise resolving to search results
   * @example
   * ```typescript
   * const results = await client.searchActors({
   *   query: 'Gandalf',
   *   type: 'npc',
   *   limit: 10
   * });
   * console.log(`Found ${results.actors.length} actors`);
   * ```
   */
  async searchActors(params: SearchActorsParams): Promise<ActorSearchResult> {
    logger.debug('Searching actors', params);

    if (this.config.useRestModule) {
      // Use cache for actor search results (2 minutes TTL)
      const cacheKey = CacheKeys.actorSearch(
        params.query || '', 
        params.type, 
        params.limit
      );
      
      return cache.getOrSet(cacheKey, async () => {
        return this.searchActorsUncached(params);
      }, 120); // 2 minutes
    } else {
      // Fallback: return mock data or empty array
      logger.warn('Actor search requires REST API module - returning empty results');
      return { actors: [], total: 0, page: 1, limit: params.limit || 10 };
    }
  }

  /**
   * Search actors without caching
   */
  private async searchActorsUncached(params: SearchActorsParams): Promise<ActorSearchResult> {
    return await this.executeWithRetry(async () => {
      const queryParams = new URLSearchParams();
      if (params.query) {
        queryParams.append('search', params.query);
      }
      if (params.type) {
        queryParams.append('type', params.type);
      }
      if (params.limit) {
        queryParams.append('limit', params.limit.toString());
      }

      const response = await this.http.get(`/api/actors`, { params });
      return response.data;
    });
  }

  /**
   * Retrieves detailed information about a specific actor
   *
   * @param actorId - The ID of the actor to retrieve
   * @returns Promise resolving to actor data
   * @throws {Error} If actor is not found
   * @example
   * ```typescript
   * const actor = await client.getActor('actor-id-123');
   * console.log(`Actor: ${actor.name} (${actor.type})`);
   * ```
   */
  async getActor(actorId: string): Promise<FoundryActor> {
    if (!this.config.useRestModule) {
      throw new Error('Actor retrieval requires REST API module');
    }

    // Use cache for actor details (5 minutes TTL)
    return cache.getOrSet(CacheKeys.actor(actorId), async () => {
      return this.getActorUncached(actorId);
    }, 300); // 5 minutes
  }

  /**
   * Get actor details without caching
   */
  private async getActorUncached(actorId: string): Promise<FoundryActor> {
    return this.executeWithRetry(async () => {
      try {
        const response = await this.http.get(`/api/actors/${actorId}`);
        return response.data;
      } catch (error: unknown) {
        // Preserve 404 errors as meaningful actor not found errors
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          throw new Error(`Actor not found: ${actorId}`);
        }
        // Re-throw other errors for retry handling
        throw error;
      }
    });
  }

  /**
   * Searches for items in FoundryVTT
   *
   * @param params - Search parameters
   * @returns Promise resolving to search results
   * @example
   * ```typescript
   * const results = await client.searchItems({
   *   query: 'sword',
   *   type: 'weapon',
   *   rarity: 'rare'
   * });
   * console.log(`Found ${results.items.length} items`);
   * ```
   */
  async searchItems(params: SearchItemsParams): Promise<ItemSearchResult> {
    logger.debug('Searching items', params);

    if (this.config.useRestModule) {
      return this.executeWithRetry(async () => {
        const response = await this.http.get(`/api/items`, { params });
        return response.data;
      });
    } else {
      logger.warn('Item search requires REST API module - returning empty results');
      return { items: [], total: 0, page: 1, limit: params.limit || 10 };
    }
  }

  /**
   * Retrieves the current active scene or a specific scene by ID
   *
   * @param sceneId - Optional scene ID. If not provided, returns current scene
   * @returns Promise resolving to scene data
   * @throws {Error} If scene is not found
   * @example
   * ```typescript
   * const currentScene = await client.getCurrentScene();
   * console.log(`Current scene: ${currentScene.name}`);
   *
   * const specificScene = await client.getCurrentScene('scene-id-123');
   * ```
   */
  async getCurrentScene(sceneId?: string): Promise<FoundryScene> {
    if (!this.config.useRestModule) {
      // Return mock scene data when no API key available
      return {
        _id: 'mock-scene',
        name: 'Unknown Scene',
        active: true,
        navigation: true,
        width: 4000,
        height: 3000,
        padding: 0.25,
        shiftX: 0,
        shiftY: 0,
        globalLight: false,
        darkness: 0,
        description: 'Scene information requires REST API module to be installed and configured.'
      };
    }

    return this.executeWithRetry(async () => {
      try {
        const endpoint = sceneId ? `/api/scenes/${sceneId}` : '/api/scenes/current';
        const response = await this.http.get(endpoint);
        return response.data;
      } catch (error: unknown) {
        // Preserve 404 errors as meaningful scene not found errors
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          throw new Error('Scene not found');
        }
        // Re-throw other errors for retry handling
        throw error;
      }
    });
  }

  /**
   * Retrieves a specific scene by ID
   *
   * @param sceneId - The ID of the scene to retrieve
   * @returns Promise resolving to scene data
   * @example
   * ```typescript
   * const scene = await client.getScene('scene-id-123');
   * console.log(`Scene: ${scene.name} (${scene.width}x${scene.height})`);
   * ```
   */
  async getScene(sceneId: string): Promise<FoundryScene> {
    return this.getCurrentScene(sceneId);
  }

  /**
   * Retrieves information about the current world
   *
   * @returns Promise resolving to world information
   * @throws {Error} If world information cannot be retrieved
   * @example
   * ```typescript
   * const world = await client.getWorldInfo();
   * console.log(`World: ${world.title} (${world.system})`);
   * ```
   */
  async getWorldInfo(): Promise<FoundryWorld> {
    if (!this.config.useRestModule) {
      // Return basic world info when no API key available
      return {
        id: 'unknown',
        title: 'FoundryVTT World',
        description: 'World information requires REST API module',
        system: 'unknown',
        coreVersion: 'unknown',
        systemVersion: 'unknown',
        playtime: 0,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };
    }

    // Use cache for world info (10 minutes TTL)
    return cache.getOrSet(CacheKeys.worldInfo(), async () => {
      return this.getWorldInfoUncached();
    }, 600); // 10 minutes
  }

  /**
   * Get world information without caching
   */
  private async getWorldInfoUncached(): Promise<FoundryWorld> {

    return this.executeWithRetry(async () => {
      const response = await this.http.get('/api/world');
      return response.data;
    });
  }

  /**
   * Establishes WebSocket connection to FoundryVTT
   *
   * @private
   * @returns Promise that resolves when WebSocket connection is established
   * @throws {Error} If WebSocket connection fails
   */
  async connectWebSocket(): Promise<void> {
    if (this.ws) {
      return; // Already connected
    }

    const wsUrl = this.config.baseUrl.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket';

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
          this._isConnected = true;
          logger.info('WebSocket connected to FoundryVTT');
          resolve();
        });

        this.ws.on('message', (data) => {
          const rawData = data.toString();

          // Handle socket.io packet types
          if (rawData.startsWith('0{')) {
            // Open packet, contains session info
            logger.info('Socket.io session opened');
            // We could parse this JSON if we needed the sid or ping interval
            return;
          }

          if (rawData === '2') {
            // Ping from server, respond with Pong
            this.ws?.send('3');
            return;
          }

          // Check for custom message packet (type '4')
          if (rawData.startsWith('4')) {
            const jsonData = rawData.substring(1);
            if (!jsonData) {
              logger.debug('Received empty socket.io message packet');
              return;
            }

            // Check message size to prevent JSON bomb attacks
            if (jsonData.length > MAX_WEBSOCKET_MESSAGE_SIZE) {
              logger.warn('WebSocket message too large, ignoring', { size: jsonData.length });
              return;
            }

            try {
              const message = JSON.parse(jsonData);
              
              // Validate message structure before processing
              if (isValidWebSocketMessage(message)) {
                this.handleWebSocketMessage(message);
              } else {
                logger.warn('Received malformed WebSocket message, ignoring', { 
                  messageType: typeof message,
                  hasType: message && typeof message.type
                });
              }
            } catch (error) {
              logger.warn('Failed to parse WebSocket message:', { error, jsonData });
            }
          } else {
            logger.debug('Received unhandled socket.io packet', { rawData });
          }
        });

        this.ws.on('error', (error) => {
          logger.error('WebSocket error:', error);
          this.ws = null;
          this._isConnected = false;
          reject(error);
        });

        this.ws.on('close', () => {
          logger.info('WebSocket disconnected');
          this.ws = null;
          this._isConnected = false;
        });
      } catch (error) {
        logger.error('WebSocket connection failed:', error);
        reject(error);
      }
    });
  }

  /**
   * Makes a GET request to the FoundryVTT server
   *
   * @param url - The URL path to request
   * @param config - Optional axios request configuration
   * @returns Promise resolving to the response
   * @example
   * ```typescript
   * const response = await client.get('/api/diagnostics/health');
   * console.log(response.data);
   * ```
   */
  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(async () => {
      return await this.http.get(url, config);
    });
  }

  /**
   * Makes a POST request to the FoundryVTT server
   *
   * @param url - The URL path to request
   * @param data - The data to send in the request body
   * @param config - Optional axios request configuration
   * @returns Promise resolving to the response
   * @example
   * ```typescript
   * const response = await client.post('/api/dice/roll', { formula: '1d20' });
   * console.log(response.data);
   * ```
   */
  async post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(async () => {
      return await this.http.post(url, data, config);
    });
  }

  /**
   * Makes a PUT request to the FoundryVTT server
   *
   * @param url - The URL path to request
   * @param data - The data to send in the request body
   * @param config - Optional axios request configuration
   * @returns Promise resolving to the response
   */
  async put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(async () => {
      return await this.http.put(url, data, config);
    });
  }

  /**
   * Makes a DELETE request to the FoundryVTT server
   *
   * @param url - The URL path to request
   * @param config - Optional axios request configuration
   * @returns Promise resolving to the response
   */
  async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(async () => {
      return await this.http.delete(url, config);
    });
  }

}
