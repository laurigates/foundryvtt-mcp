/**
 * @fileoverview Global cache instance singleton
 * 
 * This module provides a singleton cache instance that's configured
 * from the application configuration.
 */

import { CacheService } from './cache.js';
import { config } from '../config/index.js';

/**
 * Global cache instance
 * Initialized with configuration from config system
 */
export const cache = new CacheService(config?.cache || {
  enabled: false,
  ttlSeconds: 300,
  maxSize: 1000,
});

/**
 * Cache key generators for consistent naming
 */
export const CacheKeys = {
  worldInfo: () => 'world:info',
  actor: (id: string) => `actor:${id}`,
  actorSearch: (query: string, type?: string, limit?: number) => 
    `actor:search:${query}:${type || 'all'}:${limit || 10}`,
  item: (id: string) => `item:${id}`,
  itemSearch: (query: string, type?: string, rarity?: string, limit?: number) => 
    `item:search:${query}:${type || 'all'}:${rarity || 'all'}:${limit || 10}`,
  scene: (id?: string) => id ? `scene:${id}` : 'scene:current',
  rule: (query: string, system?: string) => `rule:${query}:${system || 'default'}`,
} as const;