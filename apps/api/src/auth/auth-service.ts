import { csrfToken, generateToken, hashToken, isTokenShape, verifyCsrfToken, verifyTelegramLogin } from '@tga/auth';
import type { ActiveSession, AuditLogRepository, FeatureFlagRepository, SessionPolicy, SessionRepository, UserRepository } from '@tga/database';
import { FlagGate } from '../common/flag-gate';
import { parseCookies, serializeCookie } from './cookies';

/** Sign in with Telegram is a new public surface: off until enabled (fail closed). */
export const AUTH_FLAG = 'auth.login';

export interface AuthServiceDeps {
  users: UserRepository;
  sessions: SessionRepository;
  audit: AuditLogRepository;
  flags: FeatureFlagRepository;
  botToken: string;
  botUsername: string;
  csrfSecret: string;
  /** Exact Origin allowed on state-changing requests (the public site origin). */
  allowedOrigin: string;
  policy: SessionPolicy;
  cookieSecure: boolean;
  now?: () => Date;
  flagCacheMs?: number;
  /** Security log for rejected attempts (no payloads, no tokens). */
  log?: (event: string, fields: Record<string, unknown>) => void;
}

/** What the controller needs from the incoming request. */
export interface AuthRequest {
  cookie: unknown;
  origin: unknown;
  contentType: unknown;
  csrf: unknown;
  userAgent: unknown;
  requestId: string;
}

export interface PublicUser {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
}

export type AuthOutcome<T> = { kind: 'ok'; value: T; setCookies: string[] } | { kind: 'error'; status: 400 | 401 | 403 | 404 | 415; code: string; message: string };

const PRE_NONCE_SECONDS = 86_400;

const toPublic = (u: ActiveSession['user']): PublicUser => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, username: u.username });

/**
 * Accounts and sessions (PHASE-16, ADR-017, D-021). Identity comes only from a verified Telegram
 * Login Widget payload. Sessions are server-side; the cookie holds an opaque token whose hash is
 * stored. State-changing requests need JSON, the exact site Origin and a CSRF token bound to the
 * current session (or, before login, to a pre-session nonce cookie, which also stops login CSRF).
 */
export class AuthService {
  private readonly gate: FlagGate;
  readonly sessionCookie: string;
  readonly preCookie: string;

  constructor(private readonly deps: AuthServiceDeps) {
    this.gate = new FlagGate(deps.flags, AUTH_FLAG, deps.flagCacheMs);
    // __Host- cookies require Secure, Path=/ and no Domain: they cannot be set by subdomains.
    this.sessionCookie = deps.cookieSecure ? '__Host-tga_session' : 'tga_session';
    this.preCookie = deps.cookieSecure ? '__Host-tga_pre' : 'tga_pre';
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private cookie(name: string, value: string, maxAgeSeconds: number): string {
    return serializeCookie(name, value, { maxAgeSeconds, secure: this.deps.cookieSecure });
  }

  private async current(req: AuthRequest): Promise<{ active: ActiveSession | null; pre: string | null }> {
    const cookies = parseCookies(req.cookie);
    const token = cookies.get(this.sessionCookie);
    const pre = cookies.get(this.preCookie);
    const active = isTokenShape(token) ? await this.deps.sessions.findActive(hashToken(token), this.now()) : null;
    return { active, pre: isTokenShape(pre) ? pre : null };
  }

  private binding(active: ActiveSession | null, pre: string | null): string | null {
    if (active) return `sess:${active.session.id}`;
    return pre ? `pre:${pre}` : null;
  }

  private reject(event: string, req: AuthRequest, status: 400 | 401 | 403 | 415, code: string, message: string, extra: Record<string, unknown> = {}): AuthOutcome<never> {
    this.deps.log?.(event, { requestId: req.requestId, code, ...extra });
    return { kind: 'error', status, code, message };
  }

  /** JSON + exact Origin + CSRF token for the caller's current binding. */
  private checkUnsafe(req: AuthRequest, binding: string | null): AuthOutcome<never> | null {
    if (typeof req.contentType !== 'string' || !/^application\/json(;|$)/i.test(req.contentType)) {
      return this.reject('auth.rejected', req, 415, 'unsupported_media_type', 'Send JSON');
    }
    if (req.origin !== this.deps.allowedOrigin) return this.reject('auth.rejected', req, 403, 'origin_not_allowed', 'Request origin not allowed');
    if (!binding || !verifyCsrfToken(this.deps.csrfSecret, binding, req.csrf)) return this.reject('auth.rejected', req, 403, 'csrf_failed', 'Missing or invalid CSRF token');
    return null;
  }

  /** Browser bootstrap: current user (if any), a CSRF token, and the login bot for the widget. */
  async session(req: AuthRequest): Promise<AuthOutcome<{ authenticated: boolean; user: PublicUser | null; csrfToken: string; loginBot: { username: string } }>> {
    if (!(await this.gate.enabled())) return { kind: 'error', status: 404, code: 'not_found', message: 'Not found' };
    const { active, pre } = await this.current(req);
    const setCookies: string[] = [];
    let binding = this.binding(active, pre);
    if (active) {
      await this.deps.sessions.touch(active.session, this.deps.policy, this.now());
    } else if (!pre) {
      const nonce = generateToken().token;
      setCookies.push(this.cookie(this.preCookie, nonce, PRE_NONCE_SECONDS));
      binding = `pre:${nonce}`;
    }
    return {
      kind: 'ok',
      value: { authenticated: !!active, user: active ? toPublic(active.user) : null, csrfToken: csrfToken(this.deps.csrfSecret, binding!), loginBot: { username: this.deps.botUsername } },
      setCookies,
    };
  }

  /** Read-only session check for the web server (no cookies are set). */
  async me(req: Pick<AuthRequest, 'cookie'>): Promise<AuthOutcome<{ authenticated: boolean; user: PublicUser | null }>> {
    if (!(await this.gate.enabled())) return { kind: 'error', status: 404, code: 'not_found', message: 'Not found' };
    const { active } = await this.current({ cookie: req.cookie, origin: null, contentType: null, csrf: null, userAgent: null, requestId: '' });
    return { kind: 'ok', value: { authenticated: !!active, user: active ? toPublic(active.user) : null }, setCookies: [] };
  }

  async loginWithTelegram(req: AuthRequest, payload: unknown): Promise<AuthOutcome<{ user: PublicUser; created: boolean; csrfToken: string }>> {
    if (!(await this.gate.enabled())) return { kind: 'error', status: 404, code: 'not_found', message: 'Not found' };
    const { active, pre } = await this.current(req);
    const denied = this.checkUnsafe(req, this.binding(active, pre));
    if (denied) return denied;

    const now = this.now();
    const verified = verifyTelegramLogin(payload, this.deps.botToken, now);
    if (!verified.ok) return this.reject('auth.login_failed', req, 401, 'invalid_login', 'Telegram sign-in could not be verified. Please try again.', { reason: verified.reason });

    const id = verified.identity;
    const { user, created } = await this.deps.users.upsertFromTelegram({ telegramUserId: id.telegramId, firstName: id.firstName, lastName: id.lastName, username: id.username }, now);
    if (user.status !== 'active') return this.reject('auth.login_failed', req, 403, 'account_disabled', 'This account is disabled.', { userId: user.id });

    // Rotate: a new session on every sign-in; the previous one (if any) ends (session fixation).
    if (active) await this.deps.sessions.revoke(active.session.id, now);
    const { token, hash } = generateToken();
    const session = await this.deps.sessions.create(user.id, hash, typeof req.userAgent === 'string' ? req.userAgent : null, this.deps.policy, now);
    await this.deps.audit.append({ actorType: 'user', actorId: user.id, action: created ? 'auth.account_created' : 'auth.login', targetType: 'user', targetId: user.id, metadata: { method: 'telegram' }, requestId: req.requestId });

    return {
      kind: 'ok',
      value: { user: toPublic({ ...user }), created, csrfToken: csrfToken(this.deps.csrfSecret, `sess:${session.id}`) },
      setCookies: [this.cookie(this.sessionCookie, token, this.deps.policy.absoluteMs / 1_000), this.cookie(this.preCookie, '', 0)],
    };
  }

  async logout(req: AuthRequest, everywhere: boolean): Promise<AuthOutcome<{ revoked: number }>> {
    if (!(await this.gate.enabled())) return { kind: 'error', status: 404, code: 'not_found', message: 'Not found' };
    const { active, pre } = await this.current(req);
    const denied = this.checkUnsafe(req, this.binding(active, pre));
    if (denied) return denied;
    if (!active) return this.reject('auth.rejected', req, 401, 'not_authenticated', 'Not signed in');
    const now = this.now();
    let revoked = 1;
    if (everywhere) revoked = await this.deps.sessions.revokeAllForUser(active.user.id, undefined, now);
    else await this.deps.sessions.revoke(active.session.id, now);
    await this.deps.audit.append({ actorType: 'user', actorId: active.user.id, action: everywhere ? 'auth.logout_all' : 'auth.logout', targetType: 'user', targetId: active.user.id, metadata: { revoked }, requestId: req.requestId });
    return { kind: 'ok', value: { revoked }, setCookies: [this.cookie(this.sessionCookie, '', 0)] };
  }
}
