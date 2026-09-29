import { Controller, Get, Header, HttpException, Inject, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { ChannelReader, ChannelView } from './channel-reader';

export const CHANNEL_READER = Symbol('CHANNEL_READER');

export interface ApiError {
  error: { code: string; message: string; requestId: string };
}

function fail(status: number, code: string, message: string, req: Request): never {
  const body: ApiError = { error: { code, message, requestId: String(req.headers['x-request-id'] ?? '') } };
  throw new HttpException(body, status);
}

/** Minimal public read endpoint for the vertical slice (API.md: GET /channels/:username). */
@Controller('api/v1/channels')
export class ChannelsController {
  constructor(@Inject(CHANNEL_READER) private readonly reader: ChannelReader) {}

  @Get(':username')
  @Header('Cache-Control', 'public, max-age=60')
  async get(@Param('username') username: string, @Req() req: Request): Promise<{ data: ChannelView; meta: { requestId: string; generatedAt: string } }> {
    if (typeof username !== 'string' || username.length > 64) fail(400, 'invalid_username', 'Not a valid public Telegram username', req);
    const result = await this.reader.read(username);
    if (result.kind === 'invalid') fail(400, 'invalid_username', 'Not a valid public Telegram username', req);
    if (result.kind === 'not_found') fail(404, 'not_found', 'Channel not found', req);
    return { data: result.view, meta: { requestId: String(req.headers['x-request-id'] ?? ''), generatedAt: new Date().toISOString() } };
  }
}
