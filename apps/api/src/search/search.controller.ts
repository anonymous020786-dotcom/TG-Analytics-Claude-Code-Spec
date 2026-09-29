import { Controller, Get, Header, HttpException, Inject, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { ApiError } from '../channels/channels.controller';
import type { ChannelListItem, Params, SearchReader, SearchResult } from './search-reader';

export const SEARCH_READER = Symbol('SEARCH_READER');

interface Meta {
  requestId: string;
  generatedAt: string;
}

const requestIdOf = (req: Request) => String(req.headers['x-request-id'] ?? '');
const meta = (req: Request): Meta => ({ requestId: requestIdOf(req), generatedAt: new Date().toISOString() });

/** Disabled search is indistinguishable from a missing route (404); bad input is 400. */
function unwrap<T>(result: SearchResult<T>, req: Request): T {
  if (result.kind === 'ok') return result.value;
  const body: ApiError =
    result.kind === 'disabled'
      ? { error: { code: 'not_found', message: 'Not found', requestId: requestIdOf(req) } }
      : { error: { code: result.code, message: result.message, requestId: requestIdOf(req) } };
  throw new HttpException(body, result.kind === 'disabled' ? 404 : 400);
}

/** Search, filters and cursor pagination over public channels/groups (API.md: GET /channels). */
@Controller('api/v1/channels')
export class ChannelListController {
  constructor(@Inject(SEARCH_READER) private readonly reader: SearchReader) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=30')
  async list(@Query() query: Params, @Req() req: Request): Promise<{ data: ChannelListItem[]; page: { nextCursor: string | null; limit: number }; meta: Meta }> {
    const { items, nextCursor, limit } = unwrap(await this.reader.list(query), req);
    return { data: items, page: { nextCursor, limit }, meta: meta(req) };
  }
}

/** Autocomplete. Not under /channels/: "suggest" is itself a valid Telegram username. */
@Controller('api/v1/search')
export class SearchController {
  constructor(@Inject(SEARCH_READER) private readonly reader: SearchReader) {}

  @Get('suggest')
  @Header('Cache-Control', 'public, max-age=30')
  async suggest(@Query() query: Params, @Req() req: Request): Promise<{ data: ChannelListItem[]; meta: Meta }> {
    return { data: unwrap(await this.reader.suggest(query), req), meta: meta(req) };
  }
}
