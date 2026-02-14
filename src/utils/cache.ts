/**
 * @fileoverview Caching utility with TTL (Time To Live) support
 * 
 * This module provides a simple in-memory cache with automatic expiration
 * and configurable size limits to improve performance for quasi-static data.
 */

import { logger } from './logger.js';

/**
 * Cache entry with metadata
 */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
  accessCount: number;
  lastAccessed: number;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  maxSize: number;
  evictions: number;
}

/**
 * Cache configuration options
 */
export interface CacheConfig {
  enabled: boolean;
  ttlSeconds: number;
  maxSize: number;
}

/**
 * Simple in-memory cache with TTL and LRU eviction
 */
export class CacheService {
  private cache = new Map<string, CacheEntry<any>>();
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;

  constructor(private config: CacheConfig) {
    if (config.enabled) {
      logger.info('Cache service initialized', {
        ttlSeconds: config.ttlSeconds,
        maxSize: config.maxSize,
      });

      // Clean up expired entries periodically
      this.cleanupInterval = setInterval(() => this.cleanup(), Math.max(config.ttlSeconds * 1000 / 4, 30000));
    }
  }

  /**
   * Get a value from the cache
   */
  get<T>(key: string): T | undefined {
    if (!this.config.enabled) {
      return undefined;
    }

    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      logger.debug('Cache miss', { key });
      return undefined;
    }

    // Check if entry has expired
    const now = Date.now();
    if (now - entry.timestamp > entry.ttl * 1000) {
      this.cache.delete(key);
      this.stats.misses++;
      logger.debug('Cache expired', { key, age: now - entry.timestamp });
      return undefined;
    }

    // Update access metadata
    entry.accessCount++;
    entry.lastAccessed = now;
    
    this.stats.hits++;
    logger.debug('Cache hit', { key, accessCount: entry.accessCount });
    return entry.value;
  }

  /**
   * Set a value in the cache with custom TTL
   */
  set<T>(key: string, value: T, customTtlSeconds?: number): void {
    if (!this.config.enabled) {
      return;
    }

    const ttl = customTtlSeconds ?? this.config.ttlSeconds;
    const now = Date.now();

    // Ensure cache doesn't exceed max size
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evictLeastRecentlyUsed();
    }

    const entry: CacheEntry<T> = {
      value,
      timestamp: now,
      ttl,
      accessCount: 0,
      lastAccessed: now,
    };

    this.cache.set(key, entry);
    logger.debug('Cache set', { key, ttl, size: this.cache.size });
  }

  /**
   * Delete a specific key from the cache
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      logger.debug('Cache deleted', { key });
    }
    return deleted;
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.evictions = 0;
    logger.info('Cache cleared', { previousSize: size });
  }

  /**
   * Get or set a value using a factory function
   */
  async getOrSet<T>(
    key: string, 
    factory: () => Promise<T>, 
    customTtlSeconds?: number
  ): Promise<T> {
    if (!this.config.enabled) {
      return await factory();
    }

    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, customTtlSeconds);
    return value;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? this.stats.hits / total : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: Math.round(hitRate * 100) / 100,
      size: this.cache.size,
      maxSize: this.config.maxSize,
      evictions: this.stats.evictions,
    };
  }

  /**
   * Check if cache is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Destroy the cache service and release resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.cache.clear();
    logger.info('Cache service destroyed');
  }

  /**
   * Get cache keys (for debugging)
   */
  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl * 1000) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Cache cleanup completed', { 
        cleaned, 
        remaining: this.cache.size 
      });
    }
  }

  /**
   * Evict least recently used entry
   */
  private evictLeastRecentlyUsed(): void {
    let lruKey: string | undefined;
    let lruTime = Date.now(); // Start with current time

    // Find the entry with the oldest lastAccessed time
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed <= lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
      this.stats.evictions++;
      logger.debug('Cache evicted LRU entry', { 
        key: lruKey, 
        age: Date.now() - lruTime 
      });
    }
  }
}