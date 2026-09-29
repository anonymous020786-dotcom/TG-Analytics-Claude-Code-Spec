/**
 * TelegramRateLimiter (RATE-LIMITING.md). Non-blocking: callers never sleep inside the
 * adapter; a denial returns how long to wait so the job can be rescheduled.
 *
 * - Token bucket per key (e.g. "bot_api:<credential>").
 * - Provider penalties (429 retry_after / FLOOD_WAIT) block the key until they expire.
 * - Returned waits include jitter so rescheduled jobs do not retry in lockstep.
 * - A wait is never shorter than the provider-given delay.
 *
 * InMemoryRateLimiter is per-process (tests, single process). Workers share one budget
 * per credential through RedisRateLimiter (PHASE-09).
 */

export type Acquire = { ok: true } | { ok: false; retryAfterMs: number };

export interface RateLimiter {
  tryAcquire(key: string): Promise<Acquire>;
  /** Record a provider rate-limit signal: block the key for at least `retryAfterMs`. */
  penalize(key: string, retryAfterMs: number): Promise<void>;
}

export interface TokenBucketOptions {
  /** Burst size. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
  /** Extra random delay added to waits, as a fraction of the wait (0..1). */
  jitterRatio?: number;
  /** Minimum absolute jitter in ms. */
  minJitterMs?: number;
  now?: () => number;
  random?: () => number;
}

/**
 * Provisional defaults: Telegram does not publish read-method limits (CAPABILITY-MATRIX §3).
 * Tune from observed retry_after values before raising them.
 */
export const DEFAULT_BOT_API_LIMIT: TokenBucketOptions = { capacity: 5, refillPerSecond: 1 };

interface Bucket {
  tokens: number;
  updatedAt: number;
  blockedUntil: number;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly options: TokenBucketOptions) {
    if (!(options.capacity >= 1) || !(options.refillPerSecond > 0)) {
      throw new Error('rate limiter requires capacity >= 1 and refillPerSecond > 0');
    }
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  async tryAcquire(key: string): Promise<Acquire> {
    const now = this.now();
    const bucket = this.bucket(key, now);
    if (bucket.blockedUntil > now) return { ok: false, retryAfterMs: this.withJitter(bucket.blockedUntil - now) };
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true };
    }
    const msUntilToken = Math.ceil(((1 - bucket.tokens) / this.options.refillPerSecond) * 1_000);
    return { ok: false, retryAfterMs: this.withJitter(msUntilToken) };
  }

  async penalize(key: string, retryAfterMs: number): Promise<void> {
    const now = this.now();
    const bucket = this.bucket(key, now);
    bucket.blockedUntil = Math.max(bucket.blockedUntil, now + Math.max(0, retryAfterMs));
    bucket.tokens = 0;
  }

  private bucket(key: string, now: number): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.options.capacity, updatedAt: now, blockedUntil: 0 };
      this.buckets.set(key, b);
      return b;
    }
    const elapsed = Math.max(0, now - b.updatedAt) / 1_000;
    b.tokens = Math.min(this.options.capacity, b.tokens + elapsed * this.options.refillPerSecond);
    b.updatedAt = now;
    return b;
  }

  private withJitter(waitMs: number): number {
    const ratio = this.options.jitterRatio ?? 0.2;
    const jitter = Math.max(this.options.minJitterMs ?? 100, waitMs * ratio) * this.random();
    return Math.ceil(waitMs + jitter);
  }
}
