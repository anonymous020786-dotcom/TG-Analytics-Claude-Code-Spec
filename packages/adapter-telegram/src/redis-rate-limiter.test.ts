import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { TelegramError } from './errors';
import { RedisRateLimiter } from './redis-rate-limiter';

const url = process.env.TEST_REDIS_URL;
if (!url) throw new Error('TEST_REDIS_URL is required for the shared rate limiter test');

const redis = new Redis(url, { maxRetriesPerRequest: 1 });
const prefix = `tga-test-${randomUUID()}:`;

afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

const limiter = (capacity: number, refillPerSecond: number) => new RedisRateLimiter({ redis, prefix, capacity, refillPerSecond, random: () => 0 });

describe('RedisRateLimiter (real Redis)', () => {
  it('enforces one shared budget across limiter instances (processes)', async () => {
    const a = limiter(3, 0.001);
    const b = limiter(3, 0.001);
    const results = [await a.tryAcquire('bot_api:shared'), await b.tryAcquire('bot_api:shared'), await a.tryAcquire('bot_api:shared'), await b.tryAcquire('bot_api:shared')];
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
  });

  it('is atomic under concurrency: never grants more than capacity', async () => {
    const l = limiter(5, 0.001);
    const results = await Promise.all(Array.from({ length: 25 }, () => l.tryAcquire('bot_api:burst')));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
  });

  it('a penalty from one process blocks the others for at least the provider wait', async () => {
    const a = limiter(10, 10);
    const b = limiter(10, 10);
    await a.penalize('bot_api:penalized', 30_000);
    const denied = await b.tryAcquire('bot_api:penalized');
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.retryAfterMs).toBeGreaterThanOrEqual(29_000);
    expect((await b.tryAcquire('bot_api:other')).ok).toBe(true);
  });

  it('fails closed when Redis is unavailable', async () => {
    const dead = new Redis('redis://127.0.0.1:1', { maxRetriesPerRequest: 0, lazyConnect: true, retryStrategy: () => null });
    const l = new RedisRateLimiter({ redis: dead, capacity: 1, refillPerSecond: 1 });
    await expect(l.tryAcquire('k')).rejects.toMatchObject({ failureClass: 'dependency_down' });
    await expect(l.tryAcquire('k')).rejects.toBeInstanceOf(TelegramError);
    dead.disconnect();
  });
});
