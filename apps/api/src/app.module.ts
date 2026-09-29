import { type DynamicModule, Module } from '@nestjs/common';
import type { ChannelReader } from './channels/channel-reader';
import { CHANNEL_READER, ChannelsController } from './channels/channels.controller';
import { HealthController } from './health/health.controller';

@Module({})
export class AppModule {
  /** Channel routes are registered only when a reader (database) is provided. */
  static register(options: { channelReader?: ChannelReader } = {}): DynamicModule {
    return {
      module: AppModule,
      controllers: options.channelReader ? [HealthController, ChannelsController] : [HealthController],
      providers: options.channelReader ? [{ provide: CHANNEL_READER, useValue: options.channelReader }] : [],
    };
  }
}
