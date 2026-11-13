import { CacheService, CACHE_OPTIONS } from '../cache.service';
import { Test } from '@nestjs/testing';

describe('CacheService (in-memory mode)', () => {
  let cache: CacheService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: CACHE_OPTIONS, useValue: {} },
      ],
    }).compile();

    cache = module.get(CacheService);
  });

  afterEach(() => {
    cache.onModuleDestroy();
  });

  it('should return null for missing key', async () => {
    expect(await cache.get('nonexistent')).toBeNull();
  });

  it('should set and get a value', async () => {
    await cache.set('key1', { foo: 'bar' });
    expect(await cache.get('key1')).toEqual({ foo: 'bar' });
  });

  it('should set and get primitive values', async () => {
    await cache.set('bool', true);
    await cache.set('num', 42);
    await cache.set('str', 'hello');

    expect(await cache.get('bool')).toBe(true);
    expect(await cache.get('num')).toBe(42);
    expect(await cache.get('str')).toBe('hello');
  });

  it('should expire entries after TTL', async () => {
    await cache.set('short', 'value', 1); // 1ms TTL
    // Wait for expiry
    await new Promise((r) => setTimeout(r, 10));
    expect(await cache.get('short')).toBeNull();
  });

  it('take returns a value once, then nothing', async () => {
    await cache.set('once', { a: 1 });

    expect(await cache.take('once')).toEqual({ a: 1 });
    expect(await cache.take('once')).toBeNull();
    expect(await cache.get('once')).toBeNull();
  });

  it('take reads and deletes in one Redis GETDEL, so only one instance gets the value', async () => {
    const redis = { getdel: jest.fn().mockResolvedValueOnce(JSON.stringify({ a: 1 })).mockResolvedValueOnce(null) };
    Object.assign(cache as any, { redis, redisConnected: true });

    const [first, second] = await Promise.all([cache.take('shared'), cache.take('shared')]);

    expect([first, second]).toEqual([{ a: 1 }, null]);
    expect(redis.getdel).toHaveBeenCalledTimes(2);
    Object.assign(cache as any, { redis: null, redisConnected: false });
  });

  it('should delete a key', async () => {
    await cache.set('key1', 'value');
    await cache.del('key1');
    expect(await cache.get('key1')).toBeNull();
  });

  it('should delete by pattern (prefix match)', async () => {
    await cache.set('plugin:system:a', true);
    await cache.set('plugin:system:b', true);
    await cache.set('plugin:tenant:x', true);

    await cache.delPattern('plugin:system:*');

    expect(await cache.get('plugin:system:a')).toBeNull();
    expect(await cache.get('plugin:system:b')).toBeNull();
    expect(await cache.get('plugin:tenant:x')).toBe(true);
  });

  it('should report stats with memory backend', () => {
    const stats = cache.getStats();
    expect(stats.backend).toBe('memory');
    expect(stats.size).toBe(0);
    expect(stats.connected).toBeUndefined();
  });

  it('should update stats after set operations', async () => {
    await cache.set('a', 1);
    await cache.set('b', 2);
    expect(cache.getStats().size).toBe(2);

    await cache.del('a');
    expect(cache.getStats().size).toBe(1);
  });

  it('should not be connected to Redis in memory mode', () => {
    expect(cache.isRedisConnected()).toBe(false);
  });

  it('should overwrite existing key', async () => {
    await cache.set('key', 'first');
    await cache.set('key', 'second');
    expect(await cache.get('key')).toBe('second');
  });

  it('should handle deleting non-existent key gracefully', async () => {
    await expect(cache.del('nope')).resolves.toBeUndefined();
  });

  it('should handle delPattern with no matches gracefully', async () => {
    await cache.set('other:key', 'val');
    await expect(cache.delPattern('missing:*')).resolves.toBeUndefined();
    expect(await cache.get('other:key')).toBe('val');
  });
});

describe('CacheService (no options)', () => {
  it('should work without CACHE_OPTIONS injected', async () => {
    const module = await Test.createTestingModule({
      providers: [CacheService],
    }).compile();

    const cache = module.get(CacheService);
    await cache.set('key', 'val');
    expect(await cache.get('key')).toBe('val');
    expect(cache.getStats().backend).toBe('memory');
    cache.onModuleDestroy();
  });
});
