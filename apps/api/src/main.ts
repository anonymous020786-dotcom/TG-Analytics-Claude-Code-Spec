import 'reflect-metadata';
import { ConfigError, redactConfig } from '@tga/config';
import {
  AnomalyRepository,
  ChannelRepository,
  createDatabase,
  FeatureFlagRepository,
  PostgresAnalyticsStore,
  AuditLogRepository,
  PostgresSearchIndex,
  RankingRepository,
  RoleRepository,
  SessionRepository,
  UserRepository,
} from '@tga/database';
import { createLogger } from '@tga/logging';
import { ChannelReader } from './channels/channel-reader';
import { createApp } from './app';
import { RankingsReader } from './rankings/rankings-reader';
import { AuthService } from './auth/auth-service';
import { assertCatalog } from './authz/permissions';
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
  // Sign in with Telegram is registered only when fully configured (bot token, username, CSRF secret).
  const roles = new RoleRepository(db);
  const authService =
    config.TELEGRAM_LOGIN_BOT_TOKEN && config.TELEGRAM_LOGIN_BOT_USERNAME && config.CSRF_SECRET
      ? new AuthService({
          users: new UserRepository(db),
          sessions: new SessionRepository(db),
          audit: new AuditLogRepository(db),
          flags,
          roles,
          botToken: config.TELEGRAM_LOGIN_BOT_TOKEN,
          botUsername: config.TELEGRAM_LOGIN_BOT_USERNAME,
          csrfSecret: config.CSRF_SECRET,
          allowedOrigin: new URL(config.PUBLIC_SITE_URL).origin,
          policy: { absoluteMs: config.SESSION_ABSOLUTE_DAYS * 86_400_000, idleMs: config.SESSION_IDLE_DAYS * 86_400_000 },
          cookieSecure: config.COOKIE_SECURE,
          log: (event, fields) => logger.warn(fields, event),
        })
      : undefined;
  if (!authService) logger.info('sign in with Telegram disabled (TELEGRAM_LOGIN_BOT_TOKEN, TELEGRAM_LOGIN_BOT_USERNAME and CSRF_SECRET not all set)');
  // Authorization (PHASE-17): the code's permission catalog must exist in the database.
  if (authService) await assertCatalog(() => roles.permissionKeys());
  const authz = authService
    ? {
        guard: { auth: authService, roles, log: (event: string, fields: Record<string, unknown>) => logger.warn(fields, event) },
        deps: { users: new UserRepository(db), sessions: new SessionRepository(db), roles, audit: new AuditLogRepository(db) },
      }
    : undefined;
  const statsReader = new StatsReader({ channels, flags, store, anomalies });
  const rankingsReader = new RankingsReader({ rankings: new RankingRepository(db), channels, flags });
  const app = await createApp({ logger: new NestLogger(logger), channelReader, searchReader, statsReader, rankingsReader, seoReader, ...(authService && authz ? { authService, authz } : authService ? { authService } : {}) });
  await app.listen(config.PORT, '0.0.0.0');
  logger.info({ config: redactConfig(apiConfigSpec, config) }, 'api listening');
}

void bootstrap();
