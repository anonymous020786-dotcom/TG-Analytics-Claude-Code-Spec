import type { INestApplication, LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

export async function createApp(logger: LoggerService | false = false): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
  app.disable('x-powered-by');
  app.enableShutdownHooks();
  return app;
}
