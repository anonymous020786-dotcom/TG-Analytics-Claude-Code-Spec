import type { Database } from '../client';
import type { FailureClass } from '@tga/types';
import { Prisma, type Job } from '../generated/prisma/client';

export interface EnqueueJobInput {
  queue: string;
  type: string;
  idempotencyKey: string;
  payloadVersion: number;
  /** IDs only, never secrets (QUEUE-ARCHITECTURE §2). */
  payload: Prisma.InputJsonValue;
  /** Always bounded; the database rejects values below 1 (CLAUDE.md: no infinite retries). */
  maxAttempts: number;
  entityId?: string;
  priority?: number;
  scheduledAt?: Date;
  traceId?: string;
}

export interface EnqueueResult {
  job: Job;
  /** false when a job with the same (queue, idempotencyKey) already existed. */
  created: boolean;
}

/** Durable job ledger (ADR-004, ADR-006). Transport integration arrives in PHASE-08. */
export class JobRepository {
  constructor(private readonly db: Database) {}

  /** Idempotent: a duplicate (queue, idempotencyKey) returns the existing job. */
  async enqueue(input: EnqueueJobInput): Promise<EnqueueResult> {
    try {
      const job = await this.db.job.create({
        data: {
          queue: input.queue,
          type: input.type,
          idempotencyKey: input.idempotencyKey,
          payloadVersion: input.payloadVersion,
          payload: input.payload,
          maxAttempts: input.maxAttempts,
          entityId: input.entityId ?? null,
          priority: input.priority ?? 0,
          traceId: input.traceId ?? null,
          ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
        },
      });
      return { job, created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const job = await this.db.job.findUniqueOrThrow({
          where: { queue_idempotencyKey: { queue: input.queue, idempotencyKey: input.idempotencyKey } },
        });
        return { job, created: false };
      }
      throw error;
    }
  }

  findById(id: string): Promise<Job | null> {
    return this.db.job.findUnique({ where: { id } });
  }

  /**
   * Outbox dispatch claim: marks due, queued jobs as dispatched and returns them. Uses
   * FOR UPDATE SKIP LOCKED so concurrent dispatchers never claim the same row. Jobs
   * dispatched longer ago than `staleAfterMs` but still queued (lost push) are re-claimed.
   */
  async claimForDispatch(queues: readonly string[], limit: number, staleAfterMs: number): Promise<DispatchClaim[]> {
    if (queues.length === 0) return [];
    const take = Math.min(Math.max(1, Math.trunc(limit)), MAX_DISPATCH_BATCH);
    return this.db.$queryRaw<DispatchClaim[]>`
      UPDATE jobs SET dispatched_at = now(), updated_at = now()
      WHERE id IN (
        SELECT id FROM jobs
        WHERE queue = ANY(${[...queues]}::text[])
          AND status = 'queued'
          AND scheduled_at <= now()
          AND (dispatched_at IS NULL OR dispatched_at < now() - (${Math.max(0, staleAfterMs)} * interval '1 millisecond'))
        ORDER BY priority DESC, scheduled_at ASC
        LIMIT ${take}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, queue`;
  }

  /**
   * Atomically moves a queued job to running and records the execution. Returns null when
   * the job is not runnable (already running/finished: duplicate delivery), so the caller
   * skips it — this is what makes consumers idempotent.
   */
  async startAttempt(jobId: string): Promise<StartedJob | null> {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Job[]>`
        UPDATE jobs SET status = 'running', attempt = attempt + 1, started_at = now(), finished_at = NULL, updated_at = now()
        WHERE id = ${jobId}::uuid AND status = 'queued' AND attempt < max_attempts
        RETURNING id, queue, type, payload, payload_version AS "payloadVersion", entity_id AS "entityId",
                  trace_id AS "traceId", attempt, max_attempts AS "maxAttempts"`;
      const job = rows[0];
      if (!job) return null;
      const last = await tx.jobAttempt.aggregate({ where: { jobId }, _max: { attempt: true } });
      const execution = (last._max.attempt ?? 0) + 1;
      await tx.jobAttempt.create({ data: { jobId, attempt: execution, startedAt: new Date() } });
      return { job, execution };
    });
  }

  async completeAttempt(jobId: string, execution: number): Promise<void> {
    const now = new Date();
    await this.db.$transaction([
      this.db.job.update({ where: { id: jobId }, data: { status: 'succeeded', finishedAt: now, lastErrorClass: null } }),
      this.db.jobAttempt.update({ where: { jobId_attempt: { jobId, attempt: execution } }, data: { outcome: 'succeeded', finishedAt: now } }),
    ]);
  }

  /** Terminal failure for this phase; backoff, DLQ and re-drive policy arrive in PHASE-09. */
  async failAttempt(jobId: string, execution: number, errorClass: FailureClass, message: string): Promise<void> {
    const now = new Date();
    const errorMessage = truncateError(message);
    await this.db.$transaction([
      this.db.job.update({ where: { id: jobId }, data: { status: 'failed', finishedAt: now, lastErrorClass: errorClass } }),
      this.db.jobAttempt.update({
        where: { jobId_attempt: { jobId, attempt: execution } },
        data: { outcome: 'failed', finishedAt: now, errorClass, errorMessage },
      }),
    ]);
  }

  /**
   * Provider rate limit: requeue no earlier than `retryAfterMs` without consuming a real
   * attempt (RATE-LIMITING.md). Total reschedules are capped, then the job fails.
   */
  async rescheduleAfterRateLimit(jobId: string, execution: number, retryAfterMs: number, message: string): Promise<'rescheduled' | 'exhausted'> {
    const previous = await this.db.jobAttempt.count({ where: { jobId, errorClass: 'rate_limited' } });
    if (previous + 1 > MAX_RATE_LIMIT_RESCHEDULES) {
      await this.failAttempt(jobId, execution, 'rate_limited', `${message} (reschedule cap reached)`);
      return 'exhausted';
    }
    const now = new Date();
    await this.db.$transaction([
      this.db.job.update({
        where: { id: jobId },
        data: {
          status: 'queued',
          attempt: { decrement: 1 },
          scheduledAt: new Date(now.getTime() + Math.max(0, retryAfterMs)),
          dispatchedAt: null,
          lastErrorClass: 'rate_limited',
        },
      }),
      this.db.jobAttempt.update({
        where: { jobId_attempt: { jobId, attempt: execution } },
        data: { outcome: 'failed', finishedAt: now, errorClass: 'rate_limited', errorMessage: truncateError(message) },
      }),
    ]);
    return 'rescheduled';
  }
}

export interface DispatchClaim {
  id: string;
  queue: string;
}

export interface StartedJob {
  job: Pick<Job, 'id' | 'queue' | 'type' | 'payload' | 'payloadVersion' | 'entityId' | 'traceId' | 'attempt' | 'maxAttempts'>;
  /** Sequential execution number (job_attempts.attempt), including rate-limited executions. */
  execution: number;
}

/** Upper bound per dispatch claim (bounded batch). */
export const MAX_DISPATCH_BATCH = 500;
/** Cap on rate-limit reschedules per job (QUEUE-ARCHITECTURE §3; provisional). */
export const MAX_RATE_LIMIT_RESCHEDULES = 20;

function truncateError(message: string): string {
  return message.slice(0, 2_000);
}
