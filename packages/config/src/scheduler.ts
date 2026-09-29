import { z } from 'zod';

/**
 * Scheduler process environment (PHASE-09). Refresh intervals are provisional until
 * OD-005 sets freshness targets (NFR-FRESH-01); they are configuration, not code.
 */
export const schedulerConfigShape = {
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
  SCHEDULER_TICK_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
  METRICS_REFRESH_MINUTES: z.coerce.number().int().min(5).max(10_080).default(360),
  METADATA_REFRESH_MINUTES: z.coerce.number().int().min(5).max(10_080).default(1_440),
};

export const schedulerSecrets = ['DATABASE_URL'] as const;
