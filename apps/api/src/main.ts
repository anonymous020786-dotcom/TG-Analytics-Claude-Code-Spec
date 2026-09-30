import 'reflect-metadata';
import { ConfigError, redactConfig } from '@tga/config';
import {
  AnomalyRepository,
  ChannelRepository,
  createDatabase,
  FeatureFlagRepository,
  PostgresAnalyticsStore,
  PostgresSearchIndex,
  RankingRepository,
} from '@tga/database';
import { createLogger } from '@tga/logging';
import { ChannelReader } from './channels/channel-reader';
import { createApp } from './app';
import { RankingsReader } from './rankings/rankings-reader';
import { SearchReader } from './search/search-reader';
import { SeoReader } from './seo/seo-reader';
import { StatsReader } from './stats/stats-reader';
import { apiConfigSpec, loadApiConfig, type ApiConfig } from './config';
import { NestLogger } from './logger';

function loadOrExit(): ApiConfig {
  try {
    return loadApiConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    createLogger({ name: 'api' }).fatal({ issues: error.issues }, 'invalid configuration');
    process.exit(1);
  }
}

async function bootstrap(): Promise<void> {
  const config = loadOrExit();
  const logger = createLogger({ name: 'api', level: config.LOG_LEVEL });
  const db = createDatabase({ url: config.DATABASE_URL });
  const flags = new FeatureFlagRepository(db);
  const channels = new ChannelRepository(db);
  const store = new PostgresAnalyticsStore(db);
  const anomalies = new AnomalyRepository(db);
  const seoReader = new SeoReader({
    channels,
    flags,
    policy: {
      minMembers: BigInt(config.SEO_MIN_MEMBERS),
      minHistoryDays: config.SEO_MIN_HISTORY_DAYS,
      maxAgeMs: 2 * config.METRICS_REFRESH_MINUTES * 60_000,
    },
  });
  const channelReader = new ChannelReader({
    channels,
    flags,
    store,
    anomalies,
    indexable: (id) => seoReader.channelIndexable(id),
    intervals: { metricsMs: config.METRICS_REFRESH_MINUTES * 60_000, metadataMs: config.METADATA_REFRESH_MINUTES * 60_000 },
  });
  const searchReader = new SearchReader({ index: new PostgresSearchIndex(db), flags });
  const statsReader = new StatsReader({ channels, flags, store, anomalies });
  const rankingsReader = new RankingsReader({ rankings: new RankingRepository(db), channels, flags });
  const app = await createApp({ logger: new NestLogger(logger), channelReader, searchReader, statsReader, rankingsReader, seoReader });
  await app.listen(config.PORT, '0.0.0.0');
  logger.info({ config: redactConfig(apiConfigSpec, config) }, 'api listening');
}

void bootstrap();
