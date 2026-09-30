import { Body, Controller, Get, Header, HttpCode, HttpException, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiError } from '../channels/channels.controller';
import type { AuthOutcome, AuthRequest, AuthService } from './auth-service';

export const AUTH_SERVICE = Symbol('AUTH_SERVICE');

function authRequest(req: Request): AuthRequest {
  return {
    cookie: req.headers.cookie,
    origin: req.headers.origin,
    contentType: req.headers['content-type'],
    csrf: req.headers['x-csrf-token'],
    userAgent: req.headers['user-agent'],
    requestId: String(req.headers['x-request-id'] ?? ''),
  };
}

function send<T>(outcome: AuthOutcome<T>, req: Request, res: Response): { data: T } {
  if (outcome.kind === 'error') {
    const body: ApiError = { error: { code: outcome.code, message: outcome.message, requestId: String(req.headers['x-request-id'] ?? '') } };
    throw new HttpException(body, outcome.status);
  }
  if (outcome.setCookies.length > 0) res.setHeader('Set-Cookie', outcome.setCookies);
  return { data: outcome.value };
}

/** Sign in with Telegram and sessions (PHASE-16, ADR-017). Responses are never cached. */
@Controller('api/v1/auth')
export class AuthController {
  constructor(@Inject(AUTH_SERVICE) private readonly auth: AuthService) {}

  @Get('session')
  @Header('Cache-Control', 'no-store')
  async session(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return send(await this.auth.session(authRequest(req)), req, res);
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  async me(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return send(await this.auth.me({ cookie: req.headers.cookie }), req, res);
  }

  @Post('telegram')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async telegram(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return send(await this.auth.loginWithTelegram(authRequest(req), body), req, res);
  }

  @Post('logout')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return send(await this.auth.logout(authRequest(req), false), req, res);
  }

  @Post('logout-all')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async logoutAll(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return send(await this.auth.logout(authRequest(req), true), req, res);
  }
}
