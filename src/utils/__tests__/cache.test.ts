/**
 * @fileoverview Tests for the caching system
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheService } from '../cache.js';

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService({
      enabled: true,
      ttlSeconds: 1, // Short TTL for testing
      maxSize: 3, // Small size for eviction testing
    });
  });

  describe('Basic Operations', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should delete values', () => {
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should clear all values', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
    });
  });

  describe('TTL (Time To Live)', () => {
    it('should expire entries after TTL', async () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should allow custom TTL', () => {
      cache.set('key1', 'value1', 10); // 10 seconds
      expect(cache.get('key1')).toBe('value1');
    });
  });

  describe('LRU Eviction', () => {
    it('should evict least recently used entries when max size exceeded', async () => {
      cache.set('key1', 'value1');
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 1));
      cache.set('key2', 'value2');
      await new Promise(resolve => setTimeout(resolve, 1));
      cache.set('key3', 'value3');
      
      // Access key1 and key3 to make them recently used
      cache.get('key1');
      cache.get('key3');
      
      // Adding key4 should evict key2 (least recently used)
      cache.set('key4', 'value4');
      
      expect(cache.get('key1')).toBe('value1'); // Still there
      expect(cache.get('key2')).toBeUndefined(); // Evicted
      expect(cache.get('key3')).toBe('value3'); // Still there
      expect(cache.get('key4')).toBe('value4'); // New entry
    });
  });

  describe('getOrSet', () => {
    it('should return cached value if exists', async () => {
      const factory = vi.fn().mockResolvedValue('factoryValue');
      cache.set('key1', 'cachedValue');
      
      const result = await cache.getOrSet('key1', factory);
      
      expect(result).toBe('cachedValue');
      expect(factory).not.toHaveBeenCalled();
    });

    it('should call factory and cache result if not exists', async () => {
      const factory = vi.fn().mockResolvedValue('factoryValue');
      
      const result = await cache.getOrSet('key1', factory);
      
      expect(result).toBe('factoryValue');
      expect(factory).toHaveBeenCalledOnce();
      expect(cache.get('key1')).toBe('factoryValue');
    });
  });

  describe('Statistics', () => {
    it('should track hits and misses', () => {
      cache.set('key1', 'value1');
      
      cache.get('key1'); // Hit
      cache.get('key2'); // Miss
      cache.get('key1'); // Hit
      
      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.67); // 2/3 rounded
    });

    it('should track cache size', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(3);
    });
  });

  describe('Disabled Cache', () => {
    beforeEach(() => {
      cache = new CacheService({
        enabled: false,
        ttlSeconds: 300,
        maxSize: 1000,
      });
    });

    it('should not store values when disabled', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should always call factory in getOrSet when disabled', async () => {
      const factory = vi.fn().mockResolvedValue('factoryValue');
      
      const result = await cache.getOrSet('key1', factory);
      
      expect(result).toBe('factoryValue');
      expect(factory).toHaveBeenCalledOnce();
    });
  });
});