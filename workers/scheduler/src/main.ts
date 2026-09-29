import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { ConfigError, defineConfig, loadConfig, redactConfig, schedulerConfigShape, schedulerSecrets } from '@tga/config';
import { ChannelRepository, createDatabase, JobRepository, LeaseRepository } from '@tga/database';
import { createLogger } from '@tga/logging';
import { handleShutdown, QUEUES } from '@tga/queues';
import { SCHEDULER_LEASE_KEY, scheduleTick } from './scheduler';

const spec = defineConfig({ shape: schedulerConfigShape, secrets: [...schedulerSecrets] });

function main(): void {
  let config;
  try {
    config = loadConfig(spec);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    createLogger({ name: 'worker-scheduler' }).fatal({ issues: error.issues }, 'invalid configuration');
    process.exit(1);
  }
  const logger = createLogger({ name: 'worker-scheduler', level: config.LOG_LEVEL });
  logger.info({ config: redactConfig(spec, config) }, 'starting');

  const db = createDatabase({ url: config.DATABASE_URL });
  const deps = { leases: new LeaseRepository(db), channels: new ChannelRepository(db), jobs: new JobRepository(db) };
  const owner = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const tickMs = config.SCHEDULER_TICK_SECONDS * 1_000;
  const schedules = [
    { queue: QUEUES.metrics, kind: 'metrics' as const, intervalMs: config.METRICS_REFRESH_MINUTES * 60_000 },
    { queue: QUEUES.metadata, kind: 'metadata' as const, intervalMs: config.METADATA_REFRESH_MINUTES * 60_000 },
  ];

  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let stopped = false;
  const loop = async (): Promise<void> => {
    if (stopped) return;
    running = scheduleTick(deps, { owner, schedules, leaseTtlMs: tickMs * 3 })
      .then((r) => {
        if (r.acquired) logger.info({ enqueued: r.enqueued }, 'scheduler tick');
        else logger.debug('another scheduler instance holds the lease');
      })
      .catch((error: unknown) => logger.error({ err: error instanceof Error ? error.name : 'Error' }, 'scheduler tick failed'));
    await running;
    if (!stopped) timer = setTimeout(() => void loop(), tickMs);
  };
  void loop();

  handleShutdown(
    [
      {
        stop: async () => {
          stopped = true;
          if (timer) clearTimeout(timer);
          await running;
        },
      },
    ],
    async () => {
      await deps.leases.release(SCHEDULER_LEASE_KEY, owner);
      await db.$disconnect();
    },
    logger,
  );
  logger.info({ owner, tickSeconds: config.SCHEDULER_TICK_SECONDS }, 'scheduler started');
}

main();
