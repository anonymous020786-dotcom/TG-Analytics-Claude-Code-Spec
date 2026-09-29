import { RETRYABLE_FAILURE_CLASSES } from '@tga/types';
import { TelegramError } from './errors';

export interface RetryOptions {
  /** Total attempts including the first; always bounded (CLAUDE.md: no infinite retries). */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** Provisional: short in-call retries only; longer backoff happens at the job level (QUEUE-ARCHITECTURE §3). */
export const DEFAULT_RETRY: RetryOptions = { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 2_000 };

const MAX_ATTEMPTS_CEILING = 5;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retries only transient/dependency_down/unknown TelegramErrors with exponential backoff
 * and full jitter. rate_limited, authorization, invalid_input and permanent are returned
 * to the caller immediately (rate limits are rescheduled, never retried in-process).
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = DEFAULT_RETRY): Promise<T> {
  const attempts = Math.min(Math.max(1, Math.trunc(options.maxAttempts)), MAX_ATTEMPTS_CEILING);
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const retryable = error instanceof TelegramError && RETRYABLE_FAILURE_CLASSES.includes(error.failureClass);
      if (!retryable || attempt >= attempts) throw error;
      const cap = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempt - 1));
      await sleep(Math.floor(random() * cap));
    }
  }
}
