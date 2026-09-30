import 'reflect-metadata';
import { ConfigError, redactConfig } from '@tga/config';
import { AnomalyRepository, ChannelRepository, createDatabase, FeatureFlagRepository, PostgresAnalyticsStore, PostgresSearchIndex } from '@tga/database';
import { createLogger } from '@tga/logging';
import { ChannelReader } from './channels/channel-reader';
import { createApp } from './app';
import { SearchReader } from './search/search-reader';
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
  const channelReader = new ChannelReader({
    channels: new ChannelRepository(db),
    flags,
    store: new PostgresAnalyticsStore(db),
    anomalies: new AnomalyRepository(db),
    intervals: { metricsMs: config.METRICS_REFRESH_MINUTES * 60_000, metadataMs: config.METADATA_REFRESH_MINUTES * 60_000 },
  });
  const searchReader = new SearchReader({ index: new PostgresSearchIndex(db), flags });
  const app = await createApp({ logger: new NestLogger(logger), channelReader, searchReader });
  await app.listen(config.PORT, '0.0.0.0');
  logger.info({ config: redactConfig(apiConfigSpec, config) }, 'api listening');
}

void bootstrap();
