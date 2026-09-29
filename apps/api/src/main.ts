import 'reflect-metadata';
import { createLogger } from '@tga/logging';
import { createApp } from './app';
import { NestLogger } from './logger';

// Typed, validated configuration arrives in PHASE-03; until then only PORT is read.
const DEFAULT_PORT = 3001;

async function bootstrap(): Promise<void> {
  const logger = createLogger({ name: 'api' });
  const app = await createApp(new NestLogger(logger));
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  await app.listen(port, '0.0.0.0');
  logger.info({ port }, 'api listening');
}

void bootstrap();
