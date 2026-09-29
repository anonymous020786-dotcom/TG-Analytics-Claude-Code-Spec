import { type FailureClass, RETRYABLE_FAILURE_CLASSES } from '@tga/types';
import type { Database } from '../client';
import { type DeadLetterJob, type Job, type JobAttempt, Prisma } from '../generated/prisma/client';
import { clampLimit, decodeCursor, toPage, type Page } from '../pagination';

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

/** Outcome of a failed execution (QUEUE-ARCHITECTURE §3, PHASE-09). */
export type FailureOutcome = 'retry_scheduled' | 'failed' | 'dead';

type Tx = Prisma.TransactionClient;

/** Durable job ledger (ADR-004, ADR-006): dispatch, leases, retries, DLQ and re-drive. */
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
   * Atomically moves a queued job to running under a lease and records the execution.
   * Returns null when the job is not runnable (duplicate delivery, finished, exhausted),
   * so the caller skips it — this is what makes consumers idempotent.
   */
  async startAttempt(jobId: string, leaseMs: number = DEFAULT_LEASE_MS): Promise<StartedJob | null> {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<StartedJob['job'][]>`
        UPDATE jobs SET status = 'running', attempt = attempt + 1, started_at = now(), finished_at = NULL,
                        lease_expires_at = now() + (${leaseMsOf(leaseMs)} * interval '1 millisecond'), updated_at = now()
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

  /** Extends the lease of a running job; false if the job is no longer running (lost lease). */
  async heartbeat(jobId: string, leaseMs: number = DEFAULT_LEASE_MS): Promise<boolean> {
    const n = await this.db.$executeRaw`
      UPDATE jobs SET lease_expires_at = now() + (${leaseMsOf(leaseMs)} * interval '1 millisecond'), updated_at = now()
      WHERE id = ${jobId}::uuid AND status = 'running'`;
    return n === 1;
  }

  async completeAttempt(jobId: string, execution: number): Promise<void> {
    const now = new Date();
    await this.db.$transaction([
      this.db.job.update({ where: { id: jobId }, data: { status: 'succeeded', finishedAt: now, lastErrorClass: null, leaseExpiresAt: null } }),
      this.db.jobAttempt.update({ where: { jobId_attempt: { jobId, attempt: execution } }, data: { outcome: 'succeeded', finishedAt: now } }),
    ]);
  }

  /**
   * Records a failed execution and applies the retry policy (QUEUE-ARCHITECTURE §3):
   * - retryable class (transient/dependency_down/unknown) with attempts left → requeued after `retryDelayMs`;
   * - `permanent` (expected terminal, e.g. entity gone) → `failed`;
   * - anything else, or retries exhausted → `dead` + dead-letter row (re-drivable).
   */
  async recordFailure(jobId: string, execution: number, errorClass: FailureClass, message: string, retryDelayMs: number): Promise<FailureOutcome> {
    return this.db.$transaction((tx) => this.applyFailure(tx, jobId, execution, errorClass, message, retryDelayMs));
  }

  /**
   * Provider rate limit: requeue no earlier than `retryAfterMs` without consuming a real
   * attempt (RATE-LIMITING.md). Once the reschedule cap is reached the job is dead-lettered.
   */
  async rescheduleAfterRateLimit(jobId: string, execution: number, retryAfterMs: number, message: string): Promise<'rescheduled' | 'exhausted'> {
    const previous = await this.db.jobAttempt.count({ where: { jobId, errorClass: 'rate_limited' } });
    if (previous + 1 > MAX_RATE_LIMIT_RESCHEDULES) {
      await this.recordFailure(jobId, execution, 'rate_limited', `${message} (reschedule cap reached)`, 0);
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
          leaseExpiresAt: null,
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

  /**
   * Lease reaper: running jobs whose lease expired (worker crashed or stalled) are treated as
   * a `transient` failure — retried with backoff while attempts remain, otherwise dead-lettered.
   * SKIP LOCKED makes concurrent reapers safe.
   */
  async recoverExpiredLeases(limit: number, retryDelayMs: number): Promise<{ jobId: string; outcome: FailureOutcome }[]> {
    const take = Math.min(Math.max(1, Math.trunc(limit)), MAX_DISPATCH_BATCH);
    return this.db.$transaction(async (tx) => {
      const expired = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM jobs
        WHERE status = 'running' AND lease_expires_at < now()
        ORDER BY lease_expires_at ASC
        LIMIT ${take}
        FOR UPDATE SKIP LOCKED`;
      const results: { jobId: string; outcome: FailureOutcome }[] = [];
      for (const { id } of expired) {
        const open = await tx.jobAttempt.findFirst({ where: { jobId: id }, orderBy: { attempt: 'desc' } });
        const outcome = await this.applyFailure(tx, id, open?.attempt ?? null, 'transient', 'Lease expired: worker stopped or stalled', retryDelayMs);
        results.push({ jobId: id, outcome });
      }
      return results;
    });
  }

  /**
   * Safe re-drive of a dead-lettered job (PHASE-09): only `dead` jobs with an un-redriven
   * dead-letter row; resets the attempt budget; audited in the same transaction. Idempotent:
   * a second call returns 'not_dead'.
   */
  async redrive(jobId: string, actor: { actorType: 'system' | 'user'; actorId: string }, requestId?: string): Promise<'redriven' | 'not_dead'> {
    return this.db.$transaction(async (tx) => {
      const n = await tx.$executeRaw`
        UPDATE jobs SET status = 'queued', attempt = 0, scheduled_at = now(), dispatched_at = NULL,
                        lease_expires_at = NULL, finished_at = NULL, updated_at = now()
        WHERE id = ${jobId}::uuid AND status = 'dead'`;
      if (n !== 1) return 'not_dead';
      const dl = await tx.deadLetterJob.updateMany({ where: { jobId, redrivenAt: null }, data: { redrivenAt: new Date(), redrivenBy: actor.actorId } });
      if (dl.count !== 1) throw new Error(`dead job ${jobId} has no open dead-letter record`);
      await tx.auditLog.create({
        data: { actorType: actor.actorType, actorId: actor.actorId, action: 'job.redrive', targetType: 'job', targetId: jobId, requestId: requestId ?? null },
      });
      return 'redriven';
    });
  }

  /**
   * Entities that already have an unfinished (queued/running) job on `queue`. The scheduler
   * skips them, so at most one active job exists per (queue, entity) — per-entity exclusion.
   */
  async activeEntityIds(queue: string, entityIds: readonly string[]): Promise<Set<string>> {
    if (entityIds.length === 0) return new Set();
    const rows = await this.db.job.findMany({
      where: { queue, entityId: { in: [...entityIds] }, status: { in: ['queued', 'running'] } },
      select: { entityId: true },
      distinct: ['entityId'],
    });
    return new Set(rows.map((r) => r.entityId).filter((id): id is string => id !== null));
  }

  /** Attempt history for a job, oldest first (bounded). */
  attemptHistory(jobId: string): Promise<JobAttempt[]> {
    return this.db.jobAttempt.findMany({ where: { jobId }, orderBy: { attempt: 'asc' }, take: 200 });
  }

  /** Open (not yet re-driven) dead letters, newest first, cursor-paginated. */
  async listDeadLetters(input: { cursor?: string; limit?: number } = {}): Promise<Page<DeadLetterJob>> {
    const limit = clampLimit(input.limit);
    const c = input.cursor ? decodeCursor(input.cursor, { id: 'uuid' }) : undefined;
    const rows = await this.db.deadLetterJob.findMany({
      where: { redrivenAt: null, ...(c ? { id: { lt: c.id } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    return toPage(rows, limit, (last) => ({ id: last.id }));
  }

  private async applyFailure(tx: Tx, jobId: string, execution: number | null, errorClass: FailureClass, message: string, retryDelayMs: number): Promise<FailureOutcome> {
    const now = new Date();
    const errorMessage = truncateError(message);
    const job = await tx.job.findUniqueOrThrow({ where: { id: jobId }, select: { attempt: true, maxAttempts: true } });
    const retry = RETRYABLE_FAILURE_CLASSES.includes(errorClass) && job.attempt < job.maxAttempts;
    const outcome: FailureOutcome = retry ? 'retry_scheduled' : errorClass === 'permanent' ? 'failed' : 'dead';

    if (execution !== null) {
      await tx.jobAttempt.update({ where: { jobId_attempt: { jobId, attempt: execution } }, data: { outcome: 'failed', finishedAt: now, errorClass, errorMessage } });
    }
    if (outcome === 'retry_scheduled') {
      await tx.job.update({
        where: { id: jobId },
        data: { status: 'queued', scheduledAt: new Date(now.getTime() + Math.max(0, retryDelayMs)), dispatchedAt: null, leaseExpiresAt: null, lastErrorClass: errorClass },
      });
    } else {
      await tx.job.update({ where: { id: jobId }, data: { status: outcome, finishedAt: now, leaseExpiresAt: null, lastErrorClass: errorClass } });
    }
    if (outcome === 'dead') {
      await tx.deadLetterJob.upsert({
        where: { jobId },
        create: { jobId, errorClass, errorMessage },
        update: { errorClass, errorMessage, deadAt: now, redrivenAt: null, redrivenBy: null },
      });
    }
    return outcome;
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

/** Upper bound per dispatch/reaper batch (bounded batch). */
export const MAX_DISPATCH_BATCH = 500;
/** Cap on rate-limit reschedules per job (QUEUE-ARCHITECTURE §3; provisional). */
export const MAX_RATE_LIMIT_RESCHEDULES = 20;
/** Lease on a running job; workers heartbeat well within it (provisional). */
export const DEFAULT_LEASE_MS = 120_000;

function leaseMsOf(ms: number): number {
  return Math.min(Math.max(1_000, Math.trunc(ms)), 3_600_000);
}

function truncateError(message: string): string {
  return message.slice(0, 2_000);
}
