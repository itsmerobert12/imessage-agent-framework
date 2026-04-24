/**
 * Cache Manager - In-memory message caching with TTL
 */

import { logger } from './observability';

interface CacheEntry { value: string; expiry: number; }

export class CacheManager {
  private cache: Map<string, CacheEntry> = new Map();
  private ttl: number;
  private maxSize: number;

  constructor(ttlMs: number = 300000, maxSize: number = 500) {
    this.ttl = ttlMs;
    this.maxSize = maxSize;
  }

  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) { this.cache.delete(key); return null; }
    return entry.value;
  }

  set(key: string, value: string): void {
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expiry: Date.now() + this.ttl });
  }

  clear(): void { this.cache.clear(); }
  get size(): number { return this.cache.size; }
}

export default CacheManager;
