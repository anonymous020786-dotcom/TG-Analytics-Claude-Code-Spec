import { ConfigError, defineConfig, loadConfig, redactConfig } from '@tga/config';
import { ChannelRepository, createDatabase, JobRepository, PostgresSearchIndex } from '@tga/database';
import { createLogger } from '@tga/logging';
import { BullTransport, QUEUES, runQueueWorker } from '@tga/queues';
import { z } from 'zod';
import { indexChannel } from './index-channel';

// No Telegram access: documents are built from stored catalog data only.
const spec = defineConfig({
  shape: {
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    QUEUE_PREFIX: z.string().regex(/^[a-z0-9-]{1,32}$/).default('tga'),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  },
  secrets: ['DATABASE_URL', 'REDIS_URL'],
});

function main(): void {
  let config;
  try {
    config = loadConfig(spec);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    createLogger({ name: 'worker-search' }).fatal({ issues: error.issues }, 'invalid configuration');
    process.exit(1);
  }
  const logger = createLogger({ name: 'worker-search', level: config.LOG_LEVEL });
  logger.info({ config: redactConfig(spec, config) }, 'starting');

  const db = createDatabase({ url: config.DATABASE_URL });
  const transport = new BullTransport({ redisUrl: config.REDIS_URL, prefix: config.QUEUE_PREFIX });
  const deps = { channels: new ChannelRepository(db), index: new PostgresSearchIndex(db) };

  runQueueWorker<{ channelId: string }>({
    ledger: new JobRepository(db),
    transport,
    queue: QUEUES.search,
    concurrency: config.WORKER_CONCURRENCY,
    logger,
    handler: async ({ payload, job }) => {
      const outcome = await indexChannel(deps, payload.channelId);
      logger.info({ jobId: job.id, outcome }, 'search document processed');
    },
    release: async () => {
      await transport.close();
      await db.$disconnect();
    },
  });
}

main();
