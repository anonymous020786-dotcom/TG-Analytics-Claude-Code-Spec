import 'reflect-metadata';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { type ExecutionContext, HttpException, type INestApplication } from '@nestjs/common';
import { AuditLogRepository, createDatabase, FeatureFlagRepository, RoleRepository, SessionRepository, UserRepository } from '@tga/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { AUTH_FLAG, AuthService } from '../auth/auth-service';
import { PermissionGuard } from './permission.guard';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL (*_test) is required');
const db = createDatabase({ url, poolMax: 2 });
const flags = new FeatureFlagRepository(db);
const users = new UserRepository(db);
const sessions = new SessionRepository(db);
const roles = new RoleRepository(db);
const audit = new AuditLogRepository(db);

const BOT_TOKEN = '123456789:TEST-login-bot-token-for-e2e-only_abcd';
const ORIGIN = 'https://tga.example';
const denials: Record<string, unknown>[] = [];
let app: INestApplication;
let authService: AuthService;

beforeAll(async () => {
  authService = new AuthService({
    users,
    sessions,
    audit,
    flags,
    roles,
    botToken: BOT_TOKEN,
    botUsername: 'tga_login_bot',
    csrfSecret: randomBytes(32).toString('base64url'),
    allowedOrigin: ORIGIN,
    policy: { absoluteMs: 30 * 86_400_000, idleMs: 7 * 86_400_000 },
    cookieSecure: true,
    flagCacheMs: 0,
  });
  const guard = { auth: authService, roles, log: (event: string, fields: Record<string, unknown>) => denials.push({ event, ...fields }) };
  app = await createApp({ authService, authz: { guard, deps: { users, sessions, roles, audit } } });
  await app.init();
});
beforeEach(async () => {
  denials.length = 0;
  await db.$executeRawUnsafe('TRUNCATE user_roles, user_sessions, users, feature_flags RESTART IDENTITY CASCADE');
  await flags.set(AUTH_FLAG, true);
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const server = () => app.getHttpServer();

/** A signed-in browser: cookie jar + CSRF token (signs like Telegram's widget). */
async function signIn(telegramId: number, firstName: string) {
  const boot = await request(server()).get('/api/v1/auth/session');
  const pre = ([] as string[]).concat(boot.headers['set-cookie'] ?? [])[0]!.split(';')[0]!;
  const data: Record<string, string | number> = { id: telegramId, first_name: firstName, auth_date: Math.floor(Date.now() / 1000) - 2 };
  const check = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');
  const hash = createHmac('sha256', createHash('sha256').update(BOT_TOKEN).digest()).update(check).digest('hex');
  const res = await request(server()).post('/api/v1/auth/telegram').set('Cookie', pre).set('Origin', ORIGIN).set('X-CSRF-Token', boot.body.data.csrfToken).send({ ...data, hash });
  expect(res.status).toBe(200);
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('__Host-tga_session='))!.split(';')[0]!;
  return { cookie, csrf: res.body.data.csrfToken as string, userId: res.body.data.user.id as string };
}

type Browser = Awaited<ReturnType<typeof signIn>>;
const get = (path: string, b?: Browser) => (b ? request(server()).get(path).set('Cookie', b.cookie) : request(server()).get(path));
const mutate = (method: 'put' | 'delete', path: string, b: Browser, opts: { csrf?: string | null; origin?: string } = {}) => {
  let r = request(server())[method](path).set('Cookie', b.cookie).set('Origin', opts.origin ?? ORIGIN);
  const csrf = opts.csrf === undefined ? b.csrf : opts.csrf;
  if (csrf) r = r.set('X-CSRF-Token', csrf);
  return r;
};
const sessionIds = async (b: Browser) => (await get('/api/v1/auth/sessions', b)).body.data as { id: string; current: boolean }[];

describe('object-level authorization: sessions (FR-AUTH-03 IDOR, T06)', () => {
  it('lists only the caller\'s own sessions and marks the current one', async () => {
    const a1 = await signIn(1001, 'Alice');
    await signIn(1001, 'Alice'); // second browser: a1 stays valid (different session)
    await signIn(2002, 'Bob');
    const list = await sessionIds(a1);
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
  });

  it('user A cannot revoke user B\'s session: 404, and B stays signed in', async () => {
    const a = await signIn(1001, 'Alice');
    const b = await signIn(2002, 'Bob');
    const bSession = (await sessionIds(b))[0]!.id;
    const res = await mutate('delete', `/api/v1/auth/sessions/${bSession}`, a);
    expect(res.status).toBe(404);
    expect((await get('/api/v1/auth/me', b)).body.data.authenticated).toBe(true);
    expect((await mutate('delete', '/api/v1/auth/sessions/not-a-uuid', a)).status).toBe(404);
  });

  it('revokes the caller\'s other session, and their current one (signing out)', async () => {
    const a1 = await signIn(1001, 'Alice');
    const a2 = await signIn(1001, 'Alice');
    const other = (await sessionIds(a1)).find((s) => !s.current)!.id;
    const res = await mutate('delete', `/api/v1/auth/sessions/${other}`, a1);
    expect(res.body.data).toEqual({ revoked: true, current: false });
    expect((await get('/api/v1/auth/me', a2)).body.data.authenticated).toBe(false);
    const actions = (await db.auditLog.findMany({ where: { action: 'auth.session_revoked', targetId: other } })).length;
    expect(actions).toBe(1);
  });

  it('requires a session, and CSRF + Origin for changes', async () => {
    expect((await get('/api/v1/auth/sessions')).status).toBe(401);
    const a = await signIn(1001, 'Alice');
    const id = (await sessionIds(a))[0]!.id;
    expect((await mutate('delete', `/api/v1/auth/sessions/${id}`, a, { csrf: null })).body.error.code).toBe('csrf_failed');
    expect((await mutate('delete', `/api/v1/auth/sessions/${id}`, a, { origin: 'https://evil.example' })).body.error.code).toBe('origin_not_allowed');
    expect((await get('/api/v1/auth/me', a)).body.data.authenticated).toBe(true);
  });
});

describe('role-based authorization: role management (T07)', () => {
  async function admin() {
    const a = await signIn(9001, 'Admin');
    await roles.grant(a.userId, 'admin', 'ops-bootstrap');
    return a;
  }

  it('401 for anonymous, 403 (logged) for users without the permission', async () => {
    const target = await signIn(2002, 'Bob');
    expect((await get(`/api/v1/admin/users/${target.userId}/roles`)).status).toBe(401);
    const res = await get(`/api/v1/admin/users/${target.userId}/roles`, target);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    expect(denials).toContainEqual(expect.objectContaining({ event: 'authz.denied', userId: target.userId, permission: 'roles.manage' }));
    expect((await mutate('put', `/api/v1/admin/users/${target.userId}/roles/admin`, target)).status).toBe(403);
    expect(await roles.rolesOf(target.userId)).toEqual([]);
  });

  it('an admin grants a role; it applies immediately and is audited; granting twice is idempotent', async () => {
    const a = await admin();
    const bob = await signIn(2002, 'Bob');
    expect((await get(`/api/v1/admin/users/${a.userId}/roles`, bob)).status).toBe(403);
    const res = await mutate('put', `/api/v1/admin/users/${bob.userId}/roles/admin`, a);
    expect(res.body.data).toEqual({ userId: bob.userId, role: 'admin', granted: true });
    expect((await get(`/api/v1/admin/users/${a.userId}/roles`, bob)).body.data).toEqual({ userId: a.userId, roles: ['admin'] }); // same session, new rights
    expect((await mutate('put', `/api/v1/admin/users/${bob.userId}/roles/admin`, a)).body.data.granted).toBe(false);
    const entries = await db.auditLog.findMany({ where: { action: 'role.granted', targetId: bob.userId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorType: 'user', actorId: a.userId, metadata: { role: 'admin' } });
    expect((await get('/api/v1/auth/me', bob)).body.data.roles).toEqual(['admin']);
  });

  it('revokes roles but never the last admin (409)', async () => {
    const a = await admin();
    const last = await mutate('delete', `/api/v1/admin/users/${a.userId}/roles/admin`, a);
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe('last_role_holder');
    const bob = await signIn(2002, 'Bob');
    await mutate('put', `/api/v1/admin/users/${bob.userId}/roles/admin`, a);
    const res = await mutate('delete', `/api/v1/admin/users/${bob.userId}/roles/admin`, a);
    expect(res.body.data.revoked).toBe(true);
    expect((await get(`/api/v1/admin/users/${a.userId}/roles`, bob)).status).toBe(403); // lost immediately
    expect(await db.auditLog.count({ where: { action: 'role.revoked', targetId: bob.userId } })).toBe(1);
  });

  it('validates targets: unknown role, malformed or unknown user → 404; CSRF required', async () => {
    const a = await admin();
    const bob = await signIn(2002, 'Bob');
    expect((await mutate('put', `/api/v1/admin/users/${bob.userId}/roles/superuser`, a)).body.error.code).toBe('unknown_role');
    expect((await mutate('put', '/api/v1/admin/users/not-a-uuid/roles/admin', a)).status).toBe(404);
    expect((await mutate('put', '/api/v1/admin/users/01000000-0000-7000-8000-000000000000/roles/admin', a)).status).toBe(404);
    expect((await mutate('put', `/api/v1/admin/users/${bob.userId}/roles/admin`, a, { csrf: null })).status).toBe(403);
    expect(await roles.rolesOf(bob.userId)).toEqual([]);
  });

  it('hides guarded routes while sign-in is off', async () => {
    const a = await admin();
    await flags.set(AUTH_FLAG, false);
    expect((await get('/api/v1/auth/sessions', a)).status).toBe(404);
    expect((await get(`/api/v1/admin/users/${a.userId}/roles`, a)).status).toBe(404);
  });
});

describe('PermissionGuard is deny-by-default', () => {
  it('refuses a route that declares no requirement, before any lookup', async () => {
    const guard = new PermissionGuard({ auth: authService, roles, log: (event, fields) => denials.push({ event, ...fields }) });
    const handler = () => undefined;
    class Undeclared {}
    const ctx = {
      getHandler: () => handler,
      getClass: () => Undeclared,
      switchToHttp: () => ({ getRequest: () => ({ headers: {}, method: 'GET', path: '/x' }) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
    expect(denials).toContainEqual(expect.objectContaining({ event: 'authz.denied', reason: 'no_requirement_declared' }));
  });
});
