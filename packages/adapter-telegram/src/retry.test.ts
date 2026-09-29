import { describe, expect, it, vi } from 'vitest';
import { TelegramError } from './errors';
import { withRetry } from './retry';

const opts = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000, sleep: vi.fn(async () => {}), random: () => 1 };
const err = (cls: ConstructorParameters<typeof TelegramError>[0]) => new TelegramError(cls, 'x', 'x');

describe('withRetry', () => {
  it('retries transient failures and then succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(err('transient')).mockResolvedValue('ok');
    await expect(withRetry(fn, opts)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stops after maxAttempts (bounded)', async () => {
    const fn = vi.fn().mockRejectedValue(err('transient'));
    await expect(withRetry(fn, opts)).rejects.toBeInstanceOf(TelegramError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('caps maxAttempts even if misconfigured', async () => {
    const fn = vi.fn().mockRejectedValue(err('transient'));
    await expect(withRetry(fn, { ...opts, maxAttempts: 1_000 })).rejects.toThrow();
    expect(fn.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it.each(['rate_limited', 'authorization', 'invalid_input', 'permanent'] as const)('never retries %s', async (cls) => {
    const fn = vi.fn().mockRejectedValue(err(cls));
    await expect(withRetry(fn, opts)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-Telegram errors (programming bugs surface immediately)', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('bug'));
    await expect(withRetry(fn, opts)).rejects.toBeInstanceOf(TypeError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff capped at maxDelayMs', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = vi.fn().mockRejectedValue(err('transient'));
    await expect(withRetry(fn, { maxAttempts: 5, baseDelayMs: 400, maxDelayMs: 1_000, sleep, random: () => 0.999 })).rejects.toThrow();
    const delays = sleep.mock.calls.map((c) => c[0]);
    expect(delays).toEqual([399, 799, 999, 999]);
  });
});
