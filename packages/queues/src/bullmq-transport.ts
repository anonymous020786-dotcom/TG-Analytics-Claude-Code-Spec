import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Consumer, QueueTransport } from './contracts';

export interface BullTransportOptions {
  /** Redis URL (secret: includes the password). */
  redisUrl: string;
  /** Key prefix; isolates environments and test runs. */
  prefix?: string;
  connectTimeoutMs?: number;
  /** How long a worker holds a job lock before it is considered stalled. */
  lockDurationMs?: number;
}

/**
 * BullMQ transport (ADR-006). Jobs carry only the ledger id; BullMQ's job id = ledger id so
 * a re-dispatch of a job still waiting in Redis is a no-op. BullMQ retries are disabled
 * (attempts: 1) because retry policy lives in the ledger.
 */
export class BullTransport implements QueueTransport {
  private readonly queues = new Map<string, Queue>();
  private readonly connections: Redis[] = [];
  private readonly prefix: string;

  constructor(private readonly options: BullTransportOptions) {
    this.prefix = options.prefix ?? 'tga';
  }

  private connection(): Redis {
    // BullMQ requires maxRetriesPerRequest: null for blocking worker connections.
    const conn = new Redis(this.options.redisUrl, {
      maxRetriesPerRequest: null,
      connectTimeout: this.options.connectTimeoutMs ?? 5_000,
      lazyConnect: false,
    });
    this.connections.push(conn);
    return conn;
  }

  private queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection(), prefix: this.prefix });
      this.queues.set(name, q);
    }
    return q;
  }

  async push(queue: string, ledgerId: string): Promise<void> {
    await this.queue(queue).add(
      'run',
      { ledgerId },
      { jobId: ledgerId, attempts: 1, removeOnComplete: true, removeOnFail: { count: 1_000 } },
    );
  }

  consume(queue: string, concurrency: number, handle: (ledgerId: string) => Promise<void>): Consumer {
    const worker = new Worker(
      queue,
      async (job) => {
        const ledgerId = (job.data as { ledgerId?: unknown }).ledgerId;
        if (typeof ledgerId !== 'string') return; // Poisoned transport message: nothing to run.
        await handle(ledgerId);
      },
      {
        connection: this.connection(),
        prefix: this.prefix,
        concurrency: Math.min(Math.max(1, Math.trunc(concurrency)), 64),
        lockDuration: this.options.lockDurationMs ?? 60_000,
      },
    );
    return { close: () => worker.close() };
  }

  /** Removes every key of this transport's queues (tests only). */
  async obliterate(queue: string): Promise<void> {
    await this.queue(queue).obliterate({ force: true });
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await Promise.all(this.connections.map((c) => c.quit().catch(() => c.disconnect())));
  }
}
