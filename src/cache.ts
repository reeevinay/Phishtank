import Redis from 'ioredis';

interface MemoryCacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  hitRatio: number;
  backend: 'redis' | 'memory';
  inMemoryKeys: number;
}

export class CacheService {
  private memoryMap: Map<string, MemoryCacheEntry<unknown>> = new Map();
  private redisClient: Redis | null = null;
  private isRedisConnected: boolean = false;
  private hits: number = 0;
  private misses: number = 0;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        this.redisClient = new Redis(redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: () => null, // Do not hang if redis is down
          connectTimeout: 2000
        });

        this.redisClient.connect()
          .then(() => {
            this.isRedisConnected = true;
            console.log(`⚡ Connected to Redis cache backend at ${redisUrl}`);
          })
          .catch((err) => {
            console.warn(`⚠️  Redis unavailable (${err.message}). Falling back to in-memory TTL cache.`);
            this.isRedisConnected = false;
          });

        this.redisClient.on('error', (err) => {
          // Suppress unhandled crash and switch to in-memory
          if (this.isRedisConnected) {
            console.warn(`⚠️  Redis connection lost (${err.message}). Fallback to in-memory active.`);
          }
          this.isRedisConnected = false;
        });

        this.redisClient.on('ready', () => {
          this.isRedisConnected = true;
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`⚠️  Failed to initialize Redis client (${msg}). Using in-memory cache.`);
      }
    } else {
      console.log('⚡ Initialized In-Memory TTL Cache (Redis disabled)');
    }

    // Periodic sweep for expired memory entries (every 60s)
    setInterval(() => this.sweepExpiredMemoryEntries(), 60000).unref();
  }

  /**
   * Retrieves a typed value from Redis or In-Memory cache.
   */
  async get<T>(key: string): Promise<T | null> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        const raw = await this.redisClient.get(key);
        if (raw !== null) {
          this.hits++;
          return JSON.parse(raw) as T;
        }
      } catch (err) {
        console.warn(`Redis GET error for key ${key}, falling back to memory:`, err);
      }
    }

    // Check In-Memory Map
    const entry = this.memoryMap.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.memoryMap.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value as T;
  }

  /**
   * Sets a key-value pair with a TTL (seconds). Defaults to 3600 (1 hour).
   */
  async set<T>(key: string, value: T, ttlSeconds: number = 3600): Promise<void> {
    const serialized = JSON.stringify(value);

    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.set(key, serialized, 'EX', ttlSeconds);
      } catch (err) {
        console.warn(`Redis SET error for key ${key}:`, err);
      }
    }

    // Always maintain in memory as reliable fallback
    this.memoryMap.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  /**
   * Checks if key exists and is unexpired.
   */
  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  /**
   * Deletes a key from cache.
   */
  async delete(key: string): Promise<void> {
    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.del(key);
      } catch {
        // Ignore
      }
    }
    this.memoryMap.delete(key);
  }

  /**
   * Cleans up expired entries in memory map.
   */
  private sweepExpiredMemoryEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.memoryMap.entries()) {
      if (now > entry.expiresAt) {
        this.memoryMap.delete(key);
      }
    }
  }

  /**
   * Returns cache metrics (hits, misses, ratio, backend).
   */
  getMetrics(): CacheMetrics {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRatio: total > 0 ? Number((this.hits / total).toFixed(3)) : 0,
      backend: this.isRedisConnected ? 'redis' : 'memory',
      inMemoryKeys: this.memoryMap.size
    };
  }

  // Domain-specific caching helpers
  async getEmailVerdict<T>(emailSha256: string): Promise<T | null> {
    return this.get<T>(`email:${emailSha256}`);
  }

  async setEmailVerdict<T>(emailSha256: string, result: T, ttl: number = 3600): Promise<void> {
    return this.set(`email:${emailSha256}`, result, ttl);
  }

  async getAttachmentVerdict<T>(fileHash: string): Promise<T | null> {
    return this.get<T>(`att:${fileHash}`);
  }

  async setAttachmentVerdict<T>(fileHash: string, data: T, ttl: number = 86400): Promise<void> {
    return this.set(`att:${fileHash}`, data, ttl);
  }

  async getDomainVerdict<T>(domain: string): Promise<T | null> {
    return this.get<T>(`domain:${domain}`);
  }

  async setDomainVerdict<T>(domain: string, data: T, ttl: number = 86400): Promise<void> {
    return this.set(`domain:${domain}`, data, ttl);
  }

  async getUrlVerdict<T>(url: string): Promise<T | null> {
    return this.get<T>(`url:${url}`);
  }

  async setUrlVerdict<T>(url: string, data: T, ttl: number = 86400): Promise<void> {
    return this.set(`url:${url}`, data, ttl);
  }
}

export const cacheService = new CacheService();
export default cacheService;
