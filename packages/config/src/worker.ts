import { z } from 'zod';

/**
 * Environment shared by worker processes (PHASE-08). Each worker combines it with
 * `defineConfig`; every variable is documented in `.env.example` and CONFIGURATION.md.
 */
export const workerConfigShape = {
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  /** Key prefix for queue data in Redis (isolates environments). */
  QUEUE_PREFIX: z.string().regex(/^[a-z0-9-]{1,32}$/).default('tga'),
  /** Jobs processed in parallel by this process (bounded). */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  /** Non-secret label for the credential in use (rate-limit keys, logs). */
  TELEGRAM_CREDENTIAL_ID: z.string().regex(/^[a-z0-9-]{1,32}$/).default('bot-1'),
};

export const workerSecrets = ['DATABASE_URL', 'REDIS_URL', 'TELEGRAM_BOT_TOKEN'] as const;
