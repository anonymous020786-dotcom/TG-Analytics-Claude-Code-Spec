import type { INestApplication, LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import type { ChannelReader } from './channels/channel-reader';
import { requestId } from './common/request-id';
import type { SearchReader } from './search/search-reader';

export interface CreateAppOptions {
  logger?: LoggerService | false;
  channelReader?: ChannelReader;
  searchReader?: SearchReader;
}

export async function createApp(options: CreateAppOptions | LoggerService | false = {}): Promise<INestApplication> {
  const opts: CreateAppOptions = options === false || typeof (options as LoggerService).log === 'function' ? { logger: options as LoggerService | false } : (options as CreateAppOptions);
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register({
      ...(opts.channelReader ? { channelReader: opts.channelReader } : {}),
      ...(opts.searchReader ? { searchReader: opts.searchReader } : {}),
    }),
    { logger: opts.logger ?? false },
  );
  app.disable('x-powered-by');
  app.use(requestId);
  app.enableShutdownHooks();
  return app;
}
