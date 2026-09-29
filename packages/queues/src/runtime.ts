import type { Logger } from '@tga/logging';
import type { FailureClass } from '@tga/types';
import { FAILURE_CLASSES } from '@tga/types';
import { type Consumer, type JobLedger, type LedgerJob, parsePayload, type QueueTransport } from './contracts';

export interface DispatcherOptions {
  ledger: JobLedger;
  transport: QueueTransport;
  queues: readonly string[];
  logger: Logger;
  batchSize?: number;
  intervalMs?: number;
  /** A dispatched-but-not-started job older than this is dispatched again (lost push). */
  staleAfterMs?: number;
}

/** Outbox dispatcher: ledger (source of truth) → transport. Safe to run in several processes. */
export class Dispatcher {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;

  constructor(private readonly options: DispatcherOptions) {}

  /** One dispatch pass; returns the number of jobs pushed. */
  async tick(): Promise<number> {
    const { ledger, transport, queues, logger } = this.options;
    const claims = await ledger.claimForDispatch(queues, this.options.batchSize ?? 100, this.options.staleAfterMs ?? 300_000);
    let pushed = 0;
    for (const claim of claims) {
      try {
        await transport.push(claim.queue, claim.id);
        pushed += 1;
      } catch (error) {
        // The ledger still holds the job; the stale re-claim dispatches it again later.
        logger.warn({ jobId: claim.id, queue: claim.queue, err: errorName(error) }, 'dispatch push failed');
      }
    }
    return pushed;
  }

  start(): void {
    this.stopped = false;
    const loop = async (): Promise<void> => {
      if (this.stopped) return;
      this.running = this.tick()
        .then(() => undefined)
        .catch((error: unknown) => this.options.logger.error({ err: errorName(error) }, 'dispatch tick failed'));
      await this.running;
      if (!this.stopped) this.timer = setTimeout(() => void loop(), this.options.intervalMs ?? 1_000);
    };
    void loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }
}

export interface JobContext<P> {
  payload: P;
  job: LedgerJob;
  execution: number;
}

export type JobHandler<P> = (ctx: JobContext<P>) => Promise<void>;

export interface BackoffPolicy {
  baseMs: number;
  maxMs: number;
}

/** Provisional (OD-005): 30 s doubling per attempt, capped at 30 min. */
export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 30_000, maxMs: 1_800_000 };
/** Lease on running jobs; heartbeats renew it at a third of its length. */
export const JOB_LEASE_MS = 120_000;

/**
 * Exponential backoff with "equal jitter": between half and all of the capped delay, so
 * retries spread out (no lockstep storms) but never retry immediately.
 */
export function computeBackoffMs(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF, random: () => number = Math.random): number {
  const exp = Math.min(policy.maxMs, policy.baseMs * 2 ** Math.max(0, Math.min(30, attempt - 1)));
  return Math.floor(exp / 2 + (random() * exp) / 2);
}

export interface ConsumerRuntimeOptions<P> {
  ledger: JobLedger;
  transport: QueueTransport;
  queue: string;
  handler: JobHandler<P>;
  logger: Logger;
  concurrency?: number;
  backoff?: BackoffPolicy;
  leaseMs?: number;
}

export type ProcessOutcome = 'succeeded' | 'retry_scheduled' | 'failed' | 'dead' | 'rescheduled' | 'skipped';

/**
 * Consumer: atomic queued → running start under a lease (duplicate deliveries skipped),
 * heartbeats while the handler runs, payload validation, handler, then ledger outcome:
 * rate limits rescheduled; retryable failures backed off; others failed or dead-lettered.
 */
export class ConsumerRuntime<P> {
  private consumer: Consumer | undefined;

  constructor(private readonly options: ConsumerRuntimeOptions<P>) {}

  async process(ledgerId: string): Promise<ProcessOutcome> {
    const { ledger, handler, logger, queue } = this.options;
    const leaseMs = this.options.leaseMs ?? JOB_LEASE_MS;
    const started = await ledger.startAttempt(ledgerId, leaseMs);
    if (!started) {
      logger.debug({ jobId: ledgerId, queue }, 'job not runnable (duplicate delivery or finished); skipped');
      return 'skipped';
    }
    const { job, execution } = started;
    const log = logger.child({ jobId: job.id, queue: job.queue, execution, traceId: job.traceId ?? undefined });
    const beat = setInterval(() => {
      ledger.heartbeat(job.id, leaseMs).then(
        (alive) => { if (!alive) log.warn('lease lost while running'); },
        () => log.warn('heartbeat failed'),
      );
    }, Math.max(1_000, Math.floor(leaseMs / 3)));
    beat.unref();
    try {
      const payload = parsePayload<P>(job.queue, job.payloadVersion, job.payload);
      await handler({ payload, job, execution });
      await ledger.completeAttempt(job.id, execution);
      log.info('job succeeded');
      return 'succeeded';
    } catch (error) {
      const failureClass = classOf(error);
      const message = safeMessage(error);
      const retryAfterMs = (error as { retryAfterMs?: unknown }).retryAfterMs;
      if (failureClass === 'rate_limited' && typeof retryAfterMs === 'number') {
        const outcome = await ledger.rescheduleAfterRateLimit(job.id, execution, retryAfterMs, message);
        log.warn({ retryAfterMs, outcome }, 'job rate limited');
        return outcome === 'rescheduled' ? 'rescheduled' : 'dead';
      }
      const delay = computeBackoffMs(job.attempt, this.options.backoff);
      const outcome = await ledger.recordFailure(job.id, execution, failureClass, message, delay);
      log.warn({ failureClass, message, outcome, ...(outcome === 'retry_scheduled' ? { retryInMs: delay } : {}) }, 'job failed');
      return outcome;
    } finally {
      clearInterval(beat);
    }
  }

  start(): void {
    this.consumer = this.options.transport.consume(this.options.queue, this.options.concurrency ?? 1, async (id) => {
      await this.process(id);
    });
  }

  async stop(): Promise<void> {
    await this.consumer?.close();
  }
}

function classOf(error: unknown): FailureClass {
  const cls = (error as { failureClass?: unknown })?.failureClass;
  return typeof cls === 'string' && (FAILURE_CLASSES as readonly string[]).includes(cls) ? (cls as FailureClass) : 'unknown';
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
}

/** Error text for the ledger: bounded, with URL credentials and bot tokens removed. */
export function safeMessage(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, '$1[REDACTED]@')
    .replace(/\d{5,}:[A-Za-z0-9_-]{30,}/g, '[REDACTED]')
    .slice(0, 2_000);
}

export interface Stoppable {
  stop(): Promise<void>;
}

/**
 * Worker process lifecycle: on SIGTERM/SIGINT stop taking work, let in-flight jobs finish
 * (bounded by `shutdownTimeoutMs`), release resources, then exit.
 */
export function handleShutdown(components: Stoppable[], release: () => Promise<void>, logger: Logger, shutdownTimeoutMs = 30_000): void {
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => {
      logger.error('shutdown timed out; exiting');
      process.exit(1);
    }, shutdownTimeoutMs);
    force.unref();
    void Promise.allSettled(components.map((c) => c.stop()))
      .then(release)
      .then(() => {
        logger.info('shutdown complete');
        process.exit(0);
      })
      .catch(() => process.exit(1));
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

export interface RunQueueWorkerOptions<P> {
  ledger: JobLedger;
  transport: QueueTransport;
  queue: string;
  handler: JobHandler<P>;
  logger: Logger;
  concurrency: number;
  /** Closes transport/database connections after components stop. */
  release: () => Promise<void>;
}

export interface ReaperOptions {
  ledger: JobLedger;
  logger: Logger;
  intervalMs?: number;
  batchSize?: number;
  backoff?: BackoffPolicy;
}

/** Lease reaper: recovers jobs whose worker died (PHASE-09). Safe to run in every process. */
export class Reaper {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;
  private stopped = true;

  constructor(private readonly options: ReaperOptions) {}

  async tick(): Promise<number> {
    const recovered = await this.options.ledger.recoverExpiredLeases(this.options.batchSize ?? 100, computeBackoffMs(1, this.options.backoff));
    for (const r of recovered) this.options.logger.warn({ jobId: r.jobId, outcome: r.outcome }, 'recovered job with expired lease');
    return recovered.length;
  }

  start(): void {
    this.stopped = false;
    const loop = async (): Promise<void> => {
      if (this.stopped) return;
      this.running = this.tick().catch((error: unknown) => this.options.logger.error({ err: errorName(error) }, 'reaper tick failed'));
      await this.running;
      if (!this.stopped) this.timer = setTimeout(() => void loop(), this.options.intervalMs ?? 30_000);
    };
    void loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }
}

/** Starts dispatcher, consumer and reaper for one queue and installs graceful shutdown. */
export function runQueueWorker<P>(options: RunQueueWorkerOptions<P>): { dispatcher: Dispatcher; consumer: ConsumerRuntime<P>; reaper: Reaper } {
  const { ledger, transport, queue, handler, logger, concurrency, release } = options;
  const dispatcher = new Dispatcher({ ledger, transport, queues: [queue], logger });
  const consumer = new ConsumerRuntime<P>({ ledger, transport, queue, handler, logger, concurrency });
  const reaper = new Reaper({ ledger, logger });
  dispatcher.start();
  consumer.start();
  reaper.start();
  handleShutdown([dispatcher, consumer, reaper], release, logger);
  logger.info({ queue, concurrency }, 'worker started');
  return { dispatcher, consumer, reaper };
}
