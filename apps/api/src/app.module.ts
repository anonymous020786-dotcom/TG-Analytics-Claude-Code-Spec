import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { AUTH_SERVICE, AuthController } from './auth/auth.controller';
import type { AuthService } from './auth/auth-service';
import type { ChannelReader } from './channels/channel-reader';
import { CHANNEL_READER, ChannelsController } from './channels/channels.controller';
import { HealthController } from './health/health.controller';
import { MethodologyController, RANKINGS_READER, RankingsController, SEO_READER, SeoController, STATS_READER, StatsController } from './public-data.controller';
import type { RankingsReader } from './rankings/rankings-reader';
import type { SearchReader } from './search/search-reader';
import type { SeoReader } from './seo/seo-reader';
import { ChannelListController, SEARCH_READER, SearchController } from './search/search.controller';
import type { StatsReader } from './stats/stats-reader';

export interface AppReaders {
  channelReader?: ChannelReader;
  searchReader?: SearchReader;
  statsReader?: StatsReader;
  rankingsReader?: RankingsReader;
  seoReader?: SeoReader;
  authService?: AuthService;
}

@Module({})
export class AppModule {
  /** Data routes are registered only when their reader (database) is provided. */
  static register(options: AppReaders = {}): DynamicModule {
    const controllers: NonNullable<DynamicModule['controllers']> = [HealthController, MethodologyController];
    const providers: Provider[] = [];
    if (options.searchReader) {
      // Registered before ChannelsController so GET /channels is never shadowed.
      controllers.push(ChannelListController, SearchController);
      providers.push({ provide: SEARCH_READER, useValue: options.searchReader });
    }
    if (options.statsReader) {
      controllers.push(StatsController);
      providers.push({ provide: STATS_READER, useValue: options.statsReader });
    }
    if (options.rankingsReader) {
      controllers.push(RankingsController);
      providers.push({ provide: RANKINGS_READER, useValue: options.rankingsReader });
    }
    if (options.seoReader) {
      controllers.push(SeoController);
      providers.push({ provide: SEO_READER, useValue: options.seoReader });
    }
    if (options.authService) {
      controllers.push(AuthController);
      providers.push({ provide: AUTH_SERVICE, useValue: options.authService });
    }
    if (options.channelReader) {
      controllers.push(ChannelsController);
      providers.push({ provide: CHANNEL_READER, useValue: options.channelReader });
    }
    return { module: AppModule, controllers, providers };
  }
}
