import type { ChannelRepository, JobRepository, LeaseRepository } from '@tga/database';
import { QUEUES } from '@tga/queues';

export interface Schedule {
  queue: typeof QUEUES.metrics | typeof QUEUES.metadata;
  /** Which "last observed" field decides whether a channel is due. */
  kind: 'metrics' | 'metadata';
  intervalMs: number;
}

export interface SchedulerDeps {
  leases: LeaseRepository;
  channels: ChannelRepository;
  jobs: JobRepository;
}

export interface TickOptions {
  /** Unique id of this scheduler instance (lease holder). */
  owner: string;
  schedules: readonly Schedule[];
  now?: Date;
  leaseTtlMs: number;
  batchSize?: number;
  /** Upper bound of jobs enqueued per schedule per tick (bounded work). */
  maxPerTick?: number;
  maxAttempts?: number;
  /** Rankings to (re)compute once per window (PHASE-11). */
  rankings?: { keys: readonly string[]; intervalMs: number };
}

export interface TickResult {
  acquired: boolean;
  enqueued: Record<string, number>;
}

export const SCHEDULER_LEASE_KEY = 'scheduler:collection';

/**
 * One scheduler tick (DATA-FLOW §2 step 1). "Schedules jobs only" (SERVICE-BOUNDARIES):
 * - singleton via a lease, so concurrent scheduler instances never double-schedule;
 * - per-window idempotency keys, so a repeated tick in the same window enqueues nothing;
 * - skips entities with an unfinished job on the queue (per-entity exclusion);
 * - bounded batches and per-tick caps.
 */
export async function scheduleTick(deps: SchedulerDeps, options: TickOptions): Promise<TickResult> {
  const now = options.now ?? new Date();
  const acquired = await deps.leases.acquire(SCHEDULER_LEASE_KEY, options.owner, options.leaseTtlMs);
  const enqueued: Record<string, number> = {};
  if (!acquired) return { acquired, enqueued };

  const batchSize = options.batchSize ?? 200;
  const maxPerTick = options.maxPerTick ?? 5_000;
  for (const schedule of options.schedules) {
    const window = Math.floor(now.getTime() / schedule.intervalMs);
    const olderThan = new Date(now.getTime() - schedule.intervalMs);
    let count = 0;
    let after: string | undefined;
    while (count < maxPerTick) {
      const ids = await deps.channels.dueForCollection(schedule.kind, olderThan, after, batchSize);
      if (ids.length === 0) break;
      after = ids.at(-1);
      const active = await deps.jobs.activeEntityIds(schedule.queue, ids);
      for (const channelId of ids) {
        if (active.has(channelId) || count >= maxPerTick) continue;
        const { created } = await deps.jobs.enqueue({
          queue: schedule.queue,
          type: 'scheduled',
          idempotencyKey: `scheduled:${channelId}:${window}`,
          payloadVersion: 1,
          payload: { channelId },
          entityId: channelId,
          maxAttempts: options.maxAttempts ?? 5,
        });
        if (created) count += 1;
      }
    }
    enqueued[schedule.queue] = count;
  }

  if (options.rankings) {
    const window = Math.floor(now.getTime() / options.rankings.intervalMs);
    // asOf is the window boundary, so every scheduler instance computes the same run key.
    const asOf = new Date(window * options.rankings.intervalMs).toISOString();
    let count = 0;
    for (const key of options.rankings.keys) {
      const { created } = await deps.jobs.enqueue({
        queue: QUEUES.ranking,
        type: 'scheduled',
        idempotencyKey: `ranking:${key}:${window}`,
        payloadVersion: 1,
        payload: { ranking: key, asOf },
        maxAttempts: options.maxAttempts ?? 5,
      });
      if (created) count += 1;
    }
    enqueued[QUEUES.ranking] = count;
  }
  return { acquired, enqueued };
}
