import type { FailureClass } from '@tga/types';
import { z } from 'zod';

/** Queue catalog (QUEUE-ARCHITECTURE §1). */
export const QUEUES = {
  discovery: 'channel.discovery',
  metadata: 'channel.metadata',
  posts: 'channel.posts',
  metrics: 'channel.metrics',
  analytics: 'analytics.process',
  ranking: 'ranking.compute',
  search: 'search.index',
  notificationsEvaluate: 'notifications.evaluate',
  notificationsDeliver: 'notifications.deliver',
  exports: 'exports.generate',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const channelRef = z.object({ channelId: z.uuid() }).strict();

/**
 * Versioned payload schemas (QUEUE-ARCHITECTURE §2). Payloads carry IDs only; an unknown
 * queue/version or a malformed payload is `invalid_input` (queue-poisoning guard, T09).
 * Queues without a consumer yet have no schema; their jobs wait in the ledger.
 */
export const PAYLOAD_SCHEMAS: Partial<Record<QueueName, Record<number, z.ZodType>>> = {
  [QUEUES.discovery]: { 1: z.object({ input: z.string().min(1).max(256) }).strict() },
  [QUEUES.metadata]: { 1: channelRef },
  [QUEUES.metrics]: { 1: channelRef },
};

export class PayloadError extends Error {
  readonly failureClass: FailureClass = 'invalid_input';
  constructor(message: string) {
    super(message);
    this.name = 'PayloadError';
  }
}

export function parsePayload<T>(queue: string, version: number, payload: unknown): T {
  const schema = PAYLOAD_SCHEMAS[queue as QueueName]?.[version];
  if (!schema) throw new PayloadError(`No payload schema for ${queue} v${version}`);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new PayloadError(`Invalid ${queue} v${version} payload: ${parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ')}`);
  return parsed.data as T;
}

/** Ledger operations the runtime needs; `JobRepository` in @tga/database implements them. */
export interface LedgerJob {
  id: string;
  queue: string;
  type: string;
  payload: unknown;
  payloadVersion: number;
  entityId: string | null;
  traceId: string | null;
  attempt: number;
  maxAttempts: number;
}

export interface JobLedger {
  claimForDispatch(queues: readonly string[], limit: number, staleAfterMs: number): Promise<{ id: string; queue: string }[]>;
  startAttempt(jobId: string): Promise<{ job: LedgerJob; execution: number } | null>;
  completeAttempt(jobId: string, execution: number): Promise<void>;
  failAttempt(jobId: string, execution: number, errorClass: FailureClass, message: string): Promise<void>;
  rescheduleAfterRateLimit(jobId: string, execution: number, retryAfterMs: number, message: string): Promise<'rescheduled' | 'exhausted'>;
}

/** Transport contract (ADR-006): carries ledger ids only. */
export interface QueueTransport {
  push(queue: string, ledgerId: string): Promise<void>;
  consume(queue: string, concurrency: number, handle: (ledgerId: string) => Promise<void>): Consumer;
  close(): Promise<void>;
}

export interface Consumer {
  close(): Promise<void>;
}

/** Classified failure raised by job handlers for non-provider problems (e.g. missing entity). */
export class JobError extends Error {
  constructor(
    readonly failureClass: FailureClass,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'JobError';
  }
}
