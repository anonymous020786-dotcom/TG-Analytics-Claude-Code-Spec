import 'reflect-metadata';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { AuditLogRepository, createDatabase, FeatureFlagRepository, SessionRepository, UserRepository } from '@tga/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { AUTH_FLAG, AuthService } from './auth-service';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL (*_test) is required');
const db = createDatabase({ url, poolMax: 2 });
const flags = new FeatureFlagRepository(db);
const users = new UserRepository(db);

const BOT_TOKEN = '123456789:TEST-login-bot-token-for-e2e-only_abcd';
const ORIGIN = 'https://tga.example';
const DAY = 86_400_000;
let clock = new Date('2026-09-30T12:00:00Z');
const logged: { event: string; fields: Record<string, unknown> }[] = [];
let app: INestApplication;

beforeAll(async () => {
  const authService = new AuthService({
    users,
    sessions: new SessionRepository(db),
    audit: new AuditLogRepository(db),
    flags,
    botToken: BOT_TOKEN,
    botUsername: 'tga_login_bot',
    csrfSecret: randomBytes(32).toString('base64url'), // generated per run
    allowedOrigin: ORIGIN,
    policy: { absoluteMs: 30 * DAY, idleMs: 7 * DAY },
    cookieSecure: true,
    now: () => clock,
    flagCacheMs: 0,
    log: (event, fields) => logged.push({ event, fields }),
  });
  app = await createApp({ authService });
  await app.init();
});
beforeEach(async () => {
  clock = new Date('2026-09-30T12:00:00Z');
  logged.length = 0;
  await db.$executeRawUnsafe('TRUNCATE user_sessions, users, feature_flags RESTART IDENTITY CASCADE');
  await flags.set(AUTH_FLAG, true);
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

/** Signs like Telegram's widget (independent implementation of the documented algorithm). */
function widgetPayload(fields: Record<string, string | number> = {}, token = BOT_TOKEN) {
  const data: Record<string, string | number> = { id: 777000123, first_name: 'Ada', username: 'Ada_L', auth_date: Math.floor(clock.getTime() / 1000) - 5, ...fields };
  const check = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');
  return { ...data, hash: createHmac('sha256', createHash('sha256').update(token).digest()).update(check).digest('hex') };
}

const server = () => app.getHttpServer();
const cookiesFrom = (res: request.Response): string[] => ([] as string[]).concat(res.headers['set-cookie'] ?? []);
const jar = (setCookies: string[], prev = ''): string => {
  const map = new Map(prev.split('; ').filter(Boolean).map((c) => c.split('=') as [string, string]));
  for (const c of setCookies) {
    const [pair, ...attrs] = c.split('; ');
    const [k, v] = pair!.split('=') as [string, string];
    if (attrs.some((a) => a === 'Max-Age=0')) map.delete(k);
    else map.set(k, v);
  }
  return [...map].map(([k, v]) => `${k}=${v}`).join('; ');
};

/** Browser-like sign-in: bootstrap for a CSRF token, then post the widget payload. */
async function signIn(payload = widgetPayload(), cookie = '') {
  const boot = await request(server()).get('/api/v1/auth/session').set('Cookie', cookie);
  const c1 = jar(cookiesFrom(boot), cookie);
  const res = await request(server()).post('/api/v1/auth/telegram').set('Cookie', c1).set('Origin', ORIGIN).set('X-CSRF-Token', boot.body.data.csrfToken).send(payload);
  return { res, cookie: jar(cookiesFrom(res), c1) };
}

describe('Sign in with Telegram', () => {
  it('bootstraps with a pre-session cookie, CSRF token and the login bot', async () => {
    const res = await request(server()).get('/api/v1/auth/session');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toMatchObject({ authenticated: false, user: null, loginBot: { username: 'tga_login_bot' } });
    expect(res.body.data.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookiesFrom(res)[0]).toMatch(/^__Host-tga_pre=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=86400; Secure$/);
  });

  it('creates the account on first sign-in with a secure session cookie, then reuses it', async () => {
    const first = await signIn();
    expect(first.res.status).toBe(200);
    expect(first.res.body.data).toMatchObject({ created: true, user: { firstName: 'Ada', username: 'ada_l' } });
    const [session] = cookiesFrom(first.res);
    expect(session).toMatch(/^__Host-tga_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
    expect(cookiesFrom(first.res)[1]).toMatch(/^__Host-tga_pre=; .*Max-Age=0/);
    // The raw token is never stored: only its SHA-256.
    const token = session!.split(';')[0]!.split('=')[1]!;
    expect(await db.userSession.count({ where: { tokenHash: token } })).toBe(0);
    expect(await db.userSession.count({ where: { tokenHash: createHash('sha256').update(token).digest('hex') } })).toBe(1);

    const me = await request(server()).get('/api/v1/auth/me').set('Cookie', first.cookie);
    expect(me.body.data).toMatchObject({ authenticated: true, user: { firstName: 'Ada' } });

    const again = await signIn(widgetPayload({ first_name: 'Ada L' }));
    expect(again.res.body.data).toMatchObject({ created: false, user: { firstName: 'Ada L' } });
    expect(await db.user.count()).toBe(1);
    // audit_logs is append-only (never truncated): scope to this user's entries.
    const actions = (await db.auditLog.findMany({ where: { targetType: 'user', targetId: first.res.body.data.user.id }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['auth.account_created', 'auth.login']);
  });

  it('rotates the session on sign-in (session fixation)', async () => {
    const first = await signIn();
    const second = await signIn(widgetPayload(), first.cookie);
    expect(second.res.status).toBe(200);
    expect((await request(server()).get('/api/v1/auth/me').set('Cookie', first.cookie)).body.data.authenticated).toBe(false);
    expect((await request(server()).get('/api/v1/auth/me').set('Cookie', second.cookie)).body.data.authenticated).toBe(true);
  });

  it.each([
    ['tampered id', () => ({ ...widgetPayload(), id: 1 })],
    ['signed by another bot', () => widgetPayload({}, '999999:OTHER-bot-token-aaaaaaaaaaaaaaaaaaaaaaa')],
    ['stale auth_date', () => widgetPayload({ auth_date: Math.floor(clock.getTime() / 1000) - 3_600 })],
    ['malformed body', () => ({ id: 'x' })],
  ])('rejects a %s with a generic 401 and logs the reason', async (_label, make) => {
    const { res } = await signIn(make() as ReturnType<typeof widgetPayload>);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'invalid_login' });
    expect(cookiesFrom(res).some((c) => c.startsWith('__Host-tga_session='))).toBe(false);
    expect(logged.at(-1)).toMatchObject({ event: 'auth.login_failed', fields: { code: 'invalid_login', reason: expect.any(String) } });
    expect(JSON.stringify(logged)).not.toContain('hash');
    expect(await db.user.count()).toBe(0);
  });

  it('refuses disabled accounts', async () => {
    const first = await signIn();
    await users.setStatus(first.res.body.data.user.id, 'disabled');
    expect((await request(server()).get('/api/v1/auth/me').set('Cookie', first.cookie)).body.data.authenticated).toBe(false);
    const again = await signIn();
    expect(again.res.status).toBe(403);
    expect(again.res.body.error.code).toBe('account_disabled');
  });
});

describe('CSRF and origin protection (FR-AUTH-02, T04)', () => {
  async function boot() {
    const res = await request(server()).get('/api/v1/auth/session');
    return { cookie: jar(cookiesFrom(res)), token: res.body.data.csrfToken as string };
  }

  it('rejects a login without a CSRF token, with a wrong token, or without the pre-session cookie', async () => {
    const b = await boot();
    const post = () => request(server()).post('/api/v1/auth/telegram').set('Origin', ORIGIN);
    expect((await post().set('Cookie', b.cookie).send(widgetPayload())).body.error.code).toBe('csrf_failed');
    expect((await post().set('Cookie', b.cookie).set('X-CSRF-Token', 'A'.repeat(43)).send(widgetPayload())).status).toBe(403);
    expect((await post().set('X-CSRF-Token', b.token).send(widgetPayload())).status).toBe(403);
    const other = await boot();
    expect((await post().set('Cookie', other.cookie).set('X-CSRF-Token', b.token).send(widgetPayload())).status).toBe(403);
    expect(await db.user.count()).toBe(0);
  });

  it('rejects cross-origin or origin-less requests and non-JSON bodies', async () => {
    const b = await boot();
    const post = (origin?: string) => {
      const r = request(server()).post('/api/v1/auth/telegram').set('Cookie', b.cookie).set('X-CSRF-Token', b.token);
      return origin ? r.set('Origin', origin) : r;
    };
    expect((await post('https://evil.example').send(widgetPayload())).body.error.code).toBe('origin_not_allowed');
    expect((await post().send(widgetPayload())).body.error.code).toBe('origin_not_allowed');
    const form = await post(ORIGIN).type('form').send('id=1');
    expect(form.status).toBe(415);
  });

  it('binds the CSRF token to the session: a pre-login token is useless after sign-in', async () => {
    const b = await boot();
    const login = await request(server()).post('/api/v1/auth/telegram').set('Cookie', b.cookie).set('Origin', ORIGIN).set('X-CSRF-Token', b.token).send(widgetPayload());
    const cookie = jar(cookiesFrom(login), b.cookie);
    const stale = await request(server()).post('/api/v1/auth/logout').set('Cookie', cookie).set('Origin', ORIGIN).set('X-CSRF-Token', b.token).set('Content-Type', 'application/json').send('{}');
    expect(stale.body.error.code).toBe('csrf_failed');
    const fresh = await request(server()).post('/api/v1/auth/logout').set('Cookie', cookie).set('Origin', ORIGIN).set('X-CSRF-Token', login.body.data.csrfToken).set('Content-Type', 'application/json').send('{}');
    expect(fresh.status).toBe(200);
  });
});

describe('sessions', () => {
  const post = (path: string, cookie: string, csrf: string) => request(server()).post(path).set('Cookie', cookie).set('Origin', ORIGIN).set('X-CSRF-Token', csrf).set('Content-Type', 'application/json').send('{}');

  it('logs out: the session ends and the cookie is cleared', async () => {
    const s = await signIn();
    const res = await post('/api/v1/auth/logout', s.cookie, s.res.body.data.csrfToken);
    expect(res.status).toBe(200);
    expect(cookiesFrom(res)[0]).toMatch(/^__Host-tga_session=; .*Max-Age=0/);
    expect((await request(server()).get('/api/v1/auth/me').set('Cookie', s.cookie)).body.data.authenticated).toBe(false);
    expect((await post('/api/v1/auth/logout', s.cookie, s.res.body.data.csrfToken)).status).toBe(403); // binding gone
  });

  it('logs out everywhere', async () => {
    const a = await signIn();
    const b = await signIn();
    const res = await post('/api/v1/auth/logout-all', b.cookie, b.res.body.data.csrfToken);
    expect(res.body.data).toEqual({ revoked: 2 });
    for (const c of [a.cookie, b.cookie]) expect((await request(server()).get('/api/v1/auth/me').set('Cookie', c)).body.data.authenticated).toBe(false);
  });

  it('expires idle sessions and extends active ones', async () => {
    const s = await signIn();
    clock = new Date(clock.getTime() + 6 * DAY);
    expect((await request(server()).get('/api/v1/auth/session').set('Cookie', s.cookie)).body.data.authenticated).toBe(true);
    clock = new Date(clock.getTime() + 6 * DAY); // 12 days total, but touched at day 6
    expect((await request(server()).get('/api/v1/auth/me').set('Cookie', s.cookie)).body.data.authenticated).toBe(true);
    clock = new Date(clock.getTime() + 8 * DAY); // idle for 8 days
    expect((await request(server()).get('/api/v1/auth/me').set('Cookie', s.cookie)).body.data.authenticated).toBe(false);
  });

  it('ignores garbage session cookies', async () => {
    for (const cookie of ['__Host-tga_session=not-a-token', '__Host-tga_session=', `__Host-tga_session=${'A'.repeat(43)}`, 'x'.repeat(9_000)]) {
      expect((await request(server()).get('/api/v1/auth/me').set('Cookie', cookie)).body.data.authenticated).toBe(false);
    }
  });
});

describe('flag', () => {
  it('hides every auth route while auth.login is off', async () => {
    await flags.set(AUTH_FLAG, false);
    for (const [method, path] of [
      ['get', '/api/v1/auth/session'],
      ['get', '/api/v1/auth/me'],
      ['post', '/api/v1/auth/telegram'],
      ['post', '/api/v1/auth/logout'],
    ] as const) {
      expect((await request(server())[method](path)).status).toBe(404);
    }
  });
});
