import { BotApiClient, DEFAULT_BOT_API_LIMIT, RedisRateLimiter, TelegramClientAdapter } from '@tga/adapter-telegram';
import { Redis } from 'ioredis';
import { ConfigError, defineConfig, loadConfig, redactConfig, workerConfigShape, workerSecrets } from '@tga/config';
import { ChannelRepository, createDatabase, JobRepository, PostgresAnalyticsStore } from '@tga/database';
import { createLogger } from '@tga/logging';
import { BullTransport, QUEUES, runQueueWorker } from '@tga/queues';
import { collectMetrics } from './collect-metrics';

const spec = defineConfig({ shape: workerConfigShape, secrets: [...workerSecrets] });

function main(): void {
  let config;
  try {
    config = loadConfig(spec);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    createLogger({ name: 'worker-metrics' }).fatal({ issues: error.issues }, 'invalid configuration');
    process.exit(1);
  }
  const logger = createLogger({ name: 'worker-metrics', level: config.LOG_LEVEL });
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
  const deps = { channels: new ChannelRepository(db), store: new PostgresAnalyticsStore(db), telegram };

  runQueueWorker<{ channelId: string }>({
    ledger: new JobRepository(db),
    transport,
    queue: QUEUES.metrics,
    concurrency: config.WORKER_CONCURRENCY,
    logger,
    handler: async ({ payload, job }) => {
      await collectMetrics(deps, payload.channelId, job.id);
    },
    release: async () => {
      await transport.close();
      await limiterRedis.quit();
      await db.$disconnect();
    },
  });
}

main();
