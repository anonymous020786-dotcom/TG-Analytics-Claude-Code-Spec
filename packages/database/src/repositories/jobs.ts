import type { Database } from '../client';
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
}
