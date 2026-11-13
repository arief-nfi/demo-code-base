import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import Redis from 'ioredis';

export const CACHE_OPTIONS = Symbol('CACHE_OPTIONS');

export interface CacheOptions {
  redisUrl?: string;
}

export interface CacheStats {
  size: number;
  backend: 'redis' | 'memory';
  connected?: boolean;
}

interface MemoryCacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);

  // In-memory fallback store
  private memoryStore = new Map<string, MemoryCacheEntry<unknown>>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  // Redis client (null if not configured or failed to connect)
  private redis: Redis | null = null;
  private redisConnected = false;

  constructor(
    @Optional() @Inject(CACHE_OPTIONS) options?: CacheOptions,
  ) {
    // Start in-memory cleanup regardless (used as fallback)
    this.cleanupInterval = setInterval(() => this.cleanupMemory(), 60_000);

    if (options?.redisUrl) {
      this.initRedis(options.redisUrl);
    } else {
      this.logger.log('No REDIS_URL configured — using in-memory cache');
    }
  }

  private initRedis(url: string): void {
    try {
      this.redis = new Redis(url, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 10) return null; // Stop retrying after 10 attempts
          return Math.min(times * 200, 5_000); // Exponential backoff, max 5s
        },
        lazyConnect: false,
        enableReadyCheck: true,
      });

      this.redis.on('connect', () => {
        this.redisConnected = true;
        this.logger.log('Redis connected — using Redis cache');
      });

      this.redis.on('ready', () => {
        this.redisConnected = true;
      });

      this.redis.on('error', (err) => {
        if (this.redisConnected) {
          this.logger.warn(`Redis error — falling back to in-memory cache: ${err.message}`);
        }
        this.redisConnected = false;
      });

      this.redis.on('close', () => {
        if (this.redisConnected) {
          this.logger.warn('Redis connection closed — falling back to in-memory cache');
        }
        this.redisConnected = false;
      });

      this.redis.on('reconnecting', () => {
        this.logger.debug('Redis reconnecting...');
      });
    } catch (err) {
      this.logger.warn(
        `Failed to initialize Redis — using in-memory cache: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.redis = null;
      this.redisConnected = false;
    }
  }

  private get useRedis(): boolean {
    return this.redis !== null && this.redisConnected;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async get<T>(key: string): Promise<T | null> {
    if (this.useRedis) {
      try {
        const raw = await this.redis!.get(key);
        if (raw === null) return null;
        return JSON.parse(raw) as T;
      } catch (err) {
        this.logger.debug(`Redis get error for "${key}", falling back to memory: ${err instanceof Error ? err.message : String(err)}`);
        return this.memoryGet<T>(key);
      }
    }
    return this.memoryGet<T>(key);
  }

  async set<T>(key: string, value: T, ttlMs = 300_000): Promise<void> {
    // Always set in memory (serves as fallback)
    this.memorySet(key, value, ttlMs);

    if (this.useRedis) {
      try {
        const serialized = JSON.stringify(value);
        await this.redis!.psetex(key, ttlMs, serialized);
      } catch (err) {
        this.logger.debug(`Redis set error for "${key}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Reads a key and deletes it in one step, so only one caller gets the value even across
   * instances (Redis GETDEL): for single-use values such as OAuth states.
   */
  async take<T>(key: string): Promise<T | null> {
    const local = this.memoryGet<T>(key);
    this.memoryStore.delete(key);
    if (this.useRedis) {
      try {
        const raw = await this.redis!.getdel(key);
        return raw === null ? null : (JSON.parse(raw) as T);
      } catch (err) {
        this.logger.debug(`Redis getdel error for "${key}", falling back to memory: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return local;
  }

  async del(key: string): Promise<void> {
    this.memoryStore.delete(key);

    if (this.useRedis) {
      try {
        await this.redis!.del(key);
      } catch (err) {
        this.logger.debug(`Redis del error for "${key}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async delPattern(pattern: string): Promise<void> {
    // In-memory: prefix match
    const prefix = pattern.replace(/\*$/, '');
    for (const key of this.memoryStore.keys()) {
      if (key.startsWith(prefix)) {
        this.memoryStore.delete(key);
      }
    }

    if (this.useRedis) {
      try {
        await this.redisScanDel(pattern);
      } catch (err) {
        this.logger.debug(`Redis delPattern error for "${pattern}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  getStats(): CacheStats {
    return {
      size: this.memoryStore.size,
      backend: this.useRedis ? 'redis' : 'memory',
      connected: this.redis !== null ? this.redisConnected : undefined,
    };
  }

  /** Check if Redis is the active backend */
  isRedisConnected(): boolean {
    return this.useRedis;
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupInterval);
    this.memoryStore.clear();

    if (this.redis) {
      this.redis.disconnect();
      this.redis = null;
    }
  }

  // ─── In-Memory Operations ─────────────────────────────────────────────────

  private memoryGet<T>(key: string): T | null {
    const entry = this.memoryStore.get(key) as MemoryCacheEntry<T> | undefined;
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.memoryStore.delete(key);
      return null;
    }

    return entry.value;
  }

  private memorySet<T>(key: string, value: T, ttlMs: number): void {
    this.memoryStore.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  private cleanupMemory(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.memoryStore.entries()) {
      if (now > entry.expiresAt) {
        this.memoryStore.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug(`Cache cleanup: removed ${cleaned} expired entries`);
    }
  }

  // ─── Redis Helpers ────────────────────────────────────────────────────────

  /**
   * Delete keys matching a pattern using SCAN (production-safe, non-blocking).
   * Avoids KEYS command which blocks Redis on large datasets.
   */
  private async redisScanDel(pattern: string): Promise<void> {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis!.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.redis!.del(...keys);
      }
    } while (cursor !== '0');
  }
}
