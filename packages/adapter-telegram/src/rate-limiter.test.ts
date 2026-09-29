import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from './rate-limiter';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('InMemoryRateLimiter', () => {
  it('allows a burst up to capacity, then denies with a wait', async () => {
    const c = clock();
    const rl = new InMemoryRateLimiter({ capacity: 2, refillPerSecond: 1, now: c.now, random: () => 0 });
    expect((await rl.tryAcquire('k')).ok).toBe(true);
    expect((await rl.tryAcquire('k')).ok).toBe(true);
    const denied = await rl.tryAcquire('k');
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.retryAfterMs).toBeGreaterThanOrEqual(1_000);
  });

  it('refills over time', async () => {
    const c = clock();
    const rl = new InMemoryRateLimiter({ capacity: 1, refillPerSecond: 1, now: c.now, random: () => 0 });
    await rl.tryAcquire('k');
    expect((await rl.tryAcquire('k')).ok).toBe(false);
    c.advance(1_000);
    expect((await rl.tryAcquire('k')).ok).toBe(true);
  });

  it('never allows a call before a provider penalty expires', async () => {
    const c = clock();
    const rl = new InMemoryRateLimiter({ capacity: 10, refillPerSecond: 10, now: c.now, random: () => 0 });
    await rl.penalize('k', 30_000);
    c.advance(29_999);
    const denied = await rl.tryAcquire('k');
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.retryAfterMs).toBeGreaterThanOrEqual(1);
    c.advance(1);
    expect((await rl.tryAcquire('k')).ok).toBe(true);
  });

  it('adds jitter so rescheduled callers do not retry in lockstep, never below the penalty', async () => {
    const c = clock();
    const waits = await Promise.all([0.1, 0.5, 0.9].map(async (r) => {
      const rl = new InMemoryRateLimiter({ capacity: 1, refillPerSecond: 1, now: c.now, random: () => r });
      await rl.penalize('k', 10_000);
      const d = await rl.tryAcquire('k');
      return d.ok ? 0 : d.retryAfterMs;
    }));
    expect(new Set(waits).size).toBe(3);
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(10_000);
  });

  it('isolates keys (per credential/backend)', async () => {
    const rl = new InMemoryRateLimiter({ capacity: 1, refillPerSecond: 1, now: () => 0 });
    await rl.penalize('bot_api:a', 60_000);
    expect((await rl.tryAcquire('bot_api:b')).ok).toBe(true);
  });

  it('rejects unbounded configuration', async () => {
    expect(() => new InMemoryRateLimiter({ capacity: 0, refillPerSecond: 1 })).toThrow();
    expect(() => new InMemoryRateLimiter({ capacity: 1, refillPerSecond: 0 })).toThrow();
  });
});
