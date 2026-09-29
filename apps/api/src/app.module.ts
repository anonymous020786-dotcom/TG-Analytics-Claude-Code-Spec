import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import type { ChannelReader } from './channels/channel-reader';
import { CHANNEL_READER, ChannelsController } from './channels/channels.controller';
import { HealthController } from './health/health.controller';
import type { SearchReader } from './search/search-reader';
import { ChannelListController, SEARCH_READER, SearchController } from './search/search.controller';

@Module({})
export class AppModule {
  /** Data routes are registered only when their reader (database) is provided. */
  static register(options: { channelReader?: ChannelReader; searchReader?: SearchReader } = {}): DynamicModule {
    const controllers: DynamicModule['controllers'] = [HealthController];
    const providers: Provider[] = [];
    if (options.searchReader) {
      // Registered before ChannelsController so GET /channels is never shadowed.
      controllers.push(ChannelListController, SearchController);
      providers.push({ provide: SEARCH_READER, useValue: options.searchReader });
    }
    if (options.channelReader) {
      controllers.push(ChannelsController);
      providers.push({ provide: CHANNEL_READER, useValue: options.channelReader });
    }
    return { module: AppModule, controllers, providers };
  }
}
