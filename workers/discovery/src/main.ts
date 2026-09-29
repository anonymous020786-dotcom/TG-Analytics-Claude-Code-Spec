import { BotApiClient, DEFAULT_BOT_API_LIMIT, RedisRateLimiter, TelegramClientAdapter } from '@tga/adapter-telegram';
import { Redis } from 'ioredis';
import { ConfigError, defineConfig, loadConfig, redactConfig, workerConfigShape, workerSecrets } from '@tga/config';
import { ChannelRepository, createDatabase, JobRepository } from '@tga/database';
import { createLogger } from '@tga/logging';
import { BullTransport, QUEUES, runQueueWorker } from '@tga/queues';
import { z } from 'zod';
import { DiscoveryService } from './discovery-service';

const spec = defineConfig({
  shape: {
    ...workerConfigShape,
    /** Comma-separated usernames; when set, only these may be discovered (staging, PHASE-11B). */
    DISCOVERY_ALLOWLIST: z.string().regex(/^([a-z][a-z0-9_]{3,31})(,[a-z][a-z0-9_]{3,31})*$/).optional(),
  },
  secrets: [...workerSecrets],
});

function main(): void {
  let config;
  try {
    config = loadConfig(spec);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    createLogger({ name: 'worker-discovery' }).fatal({ issues: error.issues }, 'invalid configuration');
    process.exit(1);
  }
  const logger = createLogger({ name: 'worker-discovery', level: config.LOG_LEVEL });
  logger.info({ config: redactConfig(spec, config) }, 'starting');

  const db = createDatabase({ url: config.DATABASE_URL });
  const transport = new BullTransport({ redisUrl: config.REDIS_URL, prefix: config.QUEUE_PREFIX });
  // One Telegram budget per credential shared by every worker process (PHASE-09).
  const limiterRedis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 5_000 });
  const telegram = new TelegramClientAdapter({
    botApi: new BotApiClient({ token: config.TELEGRAM_BOT_TOKEN }),
    limiter: new RedisRateLimiter({ redis: limiterRedis, prefix: `${config.QUEUE_PREFIX}:ratelimit:`, ...DEFAULT_BOT_API_LIMIT }),
    credentialId: config.TELEGRAM_CREDENTIAL_ID,
  });
  const allowlist = config.DISCOVERY_ALLOWLIST ? new Set(config.DISCOVERY_ALLOWLIST.split(',')) : undefined;
  if (allowlist) logger.info({ allowlisted: allowlist.size }, 'discovery allow-list active');
  const discovery = new DiscoveryService(telegram, new ChannelRepository(db), new JobRepository(db), allowlist ? { allowlist } : {});

  runQueueWorker<{ input: string }>({
    ledger: new JobRepository(db),
    transport,
    queue: QUEUES.discovery,
    concurrency: config.WORKER_CONCURRENCY,
    logger,
    handler: async ({ payload, job }) => {
      const outcome = await discovery.discover(payload.input, job.traceId ? { traceId: job.traceId } : {});
      logger.info({ jobId: job.id, outcome: outcome.status }, 'discovery finished');
    },
    release: async () => {
      await transport.close();
      await limiterRedis.quit();
      await db.$disconnect();
    },
  });
}

main();
