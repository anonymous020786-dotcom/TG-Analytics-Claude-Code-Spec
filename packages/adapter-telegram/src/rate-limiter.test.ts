import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from './rate-limiter';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('InMemoryRateLimiter', () => {
  it('allows a burst up to capacity, then denies with a wait', () => {
    const c = clock();
    const rl = new InMemoryRateLimiter({ capacity: 2, refillPerSecond: 1, now: c.now, random: () => 0 });
    expect(rl.tryAcquire('k').ok).toBe(true);
    expect(rl.tryAcquire('k').ok).toBe(true);
    const denied = rl.tryAcquire('k');
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.retryAfterMs).toBeGreaterThanOrEqual(1_000);
  });

  it('refills over time', () => {
    const c = clock();
    const rl = new InMemoryRateLimiter({ capacity: 1, refillPerSecond: 1, now: c.now, random: () => 0 });
    rl.tryAcquire('k');
    expect(rl.tryAcquire('k').ok).toBe(false);
    c.advance(1_000);
    expect(rl.tryAcquire('k').ok).toBe(true);
  });

  it('never allows a call before a provider penalty expires', () => {
    const c = clock();
    const rl = new InMemoryRateLimiter({ capacity: 10, refillPerSecond: 10, now: c.now, random: () => 0 });
    rl.penalize('k', 30_000);
    c.advance(29_999);
    const denied = rl.tryAcquire('k');
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.retryAfterMs).toBeGreaterThanOrEqual(1);
    c.advance(1);
    expect(rl.tryAcquire('k').ok).toBe(true);
  });

  it('adds jitter so rescheduled callers do not retry in lockstep, never below the penalty', () => {
    const c = clock();
    const waits = [0.1, 0.5, 0.9].map((r) => {
      const rl = new InMemoryRateLimiter({ capacity: 1, refillPerSecond: 1, now: c.now, random: () => r });
      rl.penalize('k', 10_000);
      const d = rl.tryAcquire('k');
      return d.ok ? 0 : d.retryAfterMs;
    });
    expect(new Set(waits).size).toBe(3);
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(10_000);
  });

  it('isolates keys (per credential/backend)', () => {
    const rl = new InMemoryRateLimiter({ capacity: 1, refillPerSecond: 1, now: () => 0 });
    rl.penalize('bot_api:a', 60_000);
    expect(rl.tryAcquire('bot_api:b').ok).toBe(true);
  });

  it('rejects unbounded configuration', () => {
    expect(() => new InMemoryRateLimiter({ capacity: 0, refillPerSecond: 1 })).toThrow();
    expect(() => new InMemoryRateLimiter({ capacity: 1, refillPerSecond: 0 })).toThrow();
  });
});
