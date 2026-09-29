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

export interface ConsumerRuntimeOptions<P> {
  ledger: JobLedger;
  transport: QueueTransport;
  queue: string;
  handler: JobHandler<P>;
  logger: Logger;
  concurrency?: number;
}

/**
 * Consumer: atomic queued → running start (duplicate deliveries are skipped), payload
 * validation, handler, then ledger outcome. Rate limits are rescheduled; every other
 * failure is recorded with its class (retry/DLQ policy: PHASE-09).
 */
export class ConsumerRuntime<P> {
  private consumer: Consumer | undefined;

  constructor(private readonly options: ConsumerRuntimeOptions<P>) {}

  async process(ledgerId: string): Promise<'succeeded' | 'failed' | 'rescheduled' | 'skipped'> {
    const { ledger, handler, logger, queue } = this.options;
    const started = await ledger.startAttempt(ledgerId);
    if (!started) {
      logger.debug({ jobId: ledgerId, queue }, 'job not runnable (duplicate delivery or finished); skipped');
      return 'skipped';
    }
    const { job, execution } = started;
    const log = logger.child({ jobId: job.id, queue: job.queue, execution, traceId: job.traceId ?? undefined });
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
        return outcome === 'rescheduled' ? 'rescheduled' : 'failed';
      }
      await ledger.failAttempt(job.id, execution, failureClass, message);
      log.warn({ failureClass, message }, 'job failed');
      return 'failed';
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

/** Starts the dispatcher and consumer for one queue and installs graceful shutdown. */
export function runQueueWorker<P>(options: RunQueueWorkerOptions<P>): { dispatcher: Dispatcher; consumer: ConsumerRuntime<P> } {
  const { ledger, transport, queue, handler, logger, concurrency, release } = options;
  const dispatcher = new Dispatcher({ ledger, transport, queues: [queue], logger });
  const consumer = new ConsumerRuntime<P>({ ledger, transport, queue, handler, logger, concurrency });
  dispatcher.start();
  consumer.start();
  handleShutdown([dispatcher, consumer], release, logger);
  logger.info({ queue, concurrency }, 'worker started');
  return { dispatcher, consumer };
}
