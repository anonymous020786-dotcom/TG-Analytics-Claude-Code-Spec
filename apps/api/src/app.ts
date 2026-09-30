import type { INestApplication, LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, type AppReaders } from './app.module';
import { requestId } from './common/request-id';

export interface CreateAppOptions extends AppReaders {
  logger?: LoggerService | false;
}

export async function createApp(options: CreateAppOptions | LoggerService | false = {}): Promise<INestApplication> {
  const opts: CreateAppOptions = options === false || typeof (options as LoggerService).log === 'function' ? { logger: options as LoggerService | false } : (options as CreateAppOptions);
  const { logger, ...readers } = opts;
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(readers), { logger: logger ?? false });
  app.disable('x-powered-by');
  // Small JSON bodies only (the largest legitimate body is a Telegram login payload).
  app.useBodyParser('json', { limit: '16kb' });
  app.use(requestId);
  app.enableShutdownHooks();
  return app;
}
