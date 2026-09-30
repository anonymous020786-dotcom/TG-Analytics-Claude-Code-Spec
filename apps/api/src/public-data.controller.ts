import { Controller, Get, Header, HttpException, Inject, Param, Query, Req } from '@nestjs/common';
import { METRIC_REGISTRY } from '@tga/analytics';
import type { Request } from 'express';
import type { ApiError } from './channels/channels.controller';
import type { RankingsReader, RankingsResult } from './rankings/rankings-reader';
import type { StatsReader } from './stats/stats-reader';

export const STATS_READER = Symbol('STATS_READER');
export const RANKINGS_READER = Symbol('RANKINGS_READER');

const requestIdOf = (req: Request) => String(req.headers['x-request-id'] ?? '');
const meta = (req: Request) => ({ requestId: requestIdOf(req), generatedAt: new Date().toISOString() });

function fail(status: number, code: string, message: string, req: Request): never {
  const body: ApiError = { error: { code, message, requestId: requestIdOf(req) } };
  throw new HttpException(body, status);
}

function unwrap<T>(result: RankingsResult<T>, req: Request): T {
  if (result.kind === 'ok') return result.value;
  if (result.kind === 'not_found') fail(404, 'not_found', 'Not found', req);
  fail(400, result.code, result.message, req);
}

/** Daily chart series for one channel (API.md: GET /channels/:id/stats). */
@Controller('api/v1/channels')
export class StatsController {
  constructor(@Inject(STATS_READER) private readonly reader: StatsReader) {}

  @Get(':id/stats')
  @Header('Cache-Control', 'public, max-age=300')
  async stats(@Param('id') id: string, @Query('days') days: unknown, @Req() req: Request) {
    const result = await this.reader.read(id, days);
    if (result.kind === 'not_found') fail(404, 'not_found', 'Channel not found', req);
    if (result.kind === 'invalid') fail(400, 'invalid_query', result.message, req);
    return { data: result.view, meta: meta(req) };
  }
}

/** Rankings and trending (API.md: GET /rankings, GET /trending), behind flag rankings.public. */
@Controller('api/v1')
export class RankingsController {
  constructor(@Inject(RANKINGS_READER) private readonly reader: RankingsReader) {}

  @Get('rankings')
  @Header('Cache-Control', 'public, max-age=300')
  async list(@Req() req: Request) {
    return { data: unwrap(await this.reader.list(), req), meta: meta(req) };
  }

  @Get('rankings/:key')
  @Header('Cache-Control', 'public, max-age=300')
  async ranking(@Param('key') key: string, @Query() query: Record<string, unknown>, @Req() req: Request) {
    const v = unwrap(await this.reader.entries(key, query), req);
    return { data: { ranking: v.ranking, entries: v.items }, page: { nextCursor: v.nextCursor, limit: v.limit }, meta: meta(req) };
  }

  @Get('trending')
  @Header('Cache-Control', 'public, max-age=300')
  async trending(@Query() query: Record<string, unknown>, @Req() req: Request) {
    return this.ranking('trending', query, req);
  }
}

/** Metric definitions for the public methodology page (FR-ANL-01). Documentation only; no data. */
@Controller('api/v1')
export class MethodologyController {
  @Get('methodology')
  @Header('Cache-Control', 'public, max-age=3600')
  methodology(@Req() req: Request) {
    return { data: { metrics: METRIC_REGISTRY }, meta: meta(req) };
  }
}
