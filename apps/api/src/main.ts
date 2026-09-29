import 'reflect-metadata';
import { ConfigError, redactConfig } from '@tga/config';
import { createLogger } from '@tga/logging';
import { createApp } from './app';
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
  const app = await createApp(new NestLogger(logger));
  await app.listen(config.PORT, '0.0.0.0');
  logger.info({ config: redactConfig(apiConfigSpec, config) }, 'api listening');
}

void bootstrap();
