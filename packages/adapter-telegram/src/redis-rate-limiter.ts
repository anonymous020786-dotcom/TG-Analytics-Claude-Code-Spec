import type { Redis } from 'ioredis';
import { TelegramError } from './errors';
import type { Acquire, RateLimiter, TokenBucketOptions } from './rate-limiter';

/**
 * Atomic token bucket + penalty window per key. Uses Redis TIME so every worker process
 * shares one clock and one budget. Returns {allowed(1/0), waitMs}.
 */
const SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillPerMs = tonumber(ARGV[2])
local mode = ARGV[3]
local penaltyMs = tonumber(ARGV[4])
local ttlMs = tonumber(ARGV[5])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local b = redis.call('HMGET', key, 'tokens', 'ts', 'blocked')
local tokens = tonumber(b[1]) or capacity
local ts = tonumber(b[2]) or now
local blocked = tonumber(b[3]) or 0
tokens = math.min(capacity, tokens + math.max(0, now - ts) * refillPerMs)
local allowed = 0
local wait = 0
if mode == 'penalize' then
  blocked = math.max(blocked, now + penaltyMs)
  tokens = 0
  allowed = 1
elseif blocked > now then
  wait = blocked - now
elseif tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  wait = math.ceil((1 - tokens) / refillPerMs)
end
redis.call('HSET', key, 'tokens', tostring(tokens), 'ts', now, 'blocked', blocked)
redis.call('PEXPIRE', key, math.max(ttlMs, blocked - now + 1000))
return {allowed, wait}
`;

export interface RedisRateLimiterOptions extends Omit<TokenBucketOptions, 'now'> {
  redis: Redis;
  /** Key prefix (e.g. "tga:ratelimit:"). */
  prefix?: string;
}

/**
 * Shared TelegramRateLimiter (RATE-LIMITING.md: "persist state"). Fails closed: if Redis is
 * unavailable no Telegram call is made (the job is retried as dependency_down).
 */
export class RedisRateLimiter implements RateLimiter {
  private readonly prefix: string;
  private readonly random: () => number;

  constructor(private readonly options: RedisRateLimiterOptions) {
    if (!(options.capacity >= 1) || !(options.refillPerSecond > 0)) {
      throw new Error('rate limiter requires capacity >= 1 and refillPerSecond > 0');
    }
    this.prefix = options.prefix ?? 'tga:ratelimit:';
    this.random = options.random ?? Math.random;
  }

  async tryAcquire(key: string): Promise<Acquire> {
    const [allowed, wait] = await this.run(key, 'acquire', 0);
    return allowed === 1 ? { ok: true } : { ok: false, retryAfterMs: this.withJitter(wait) };
  }

  async penalize(key: string, retryAfterMs: number): Promise<void> {
    await this.run(key, 'penalize', Math.max(0, Math.ceil(retryAfterMs)));
  }

  private async run(key: string, mode: 'acquire' | 'penalize', penaltyMs: number): Promise<[number, number]> {
    const ttlMs = Math.ceil((this.options.capacity / this.options.refillPerSecond) * 1_000) + 60_000;
    try {
      const res = (await this.options.redis.eval(
        SCRIPT,
        1,
        `${this.prefix}${key}`,
        String(this.options.capacity),
        String(this.options.refillPerSecond / 1_000),
        mode,
        String(penaltyMs),
        String(ttlMs),
      )) as [number, number];
      return [Number(res[0]), Number(res[1])];
    } catch {
      throw new TelegramError('dependency_down', 'rate_limiter_unavailable', 'Shared rate limiter unavailable');
    }
  }

  private withJitter(waitMs: number): number {
    const ratio = this.options.jitterRatio ?? 0.2;
    const jitter = Math.max(this.options.minJitterMs ?? 100, waitMs * ratio) * this.random();
    return Math.ceil(waitMs + jitter);
  }
}
