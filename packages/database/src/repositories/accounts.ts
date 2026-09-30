import type { Database } from '../client';
import type { User, UserSession } from '../generated/prisma/client';

export interface TelegramUserInput {
  telegramUserId: bigint;
  firstName: string;
  lastName: string | null;
  username: string | null;
}

/** Platform users (PHASE-16, D-021): identity comes only from Sign in with Telegram. */
export class UserRepository {
  constructor(private readonly db: Database) {}

  /** Creates the account on first sign-in, otherwise refreshes the display fields. */
  async upsertFromTelegram(input: TelegramUserInput, now: Date = new Date()): Promise<{ user: User; created: boolean }> {
    const [row] = await this.db.$queryRaw<{ id: string; created: boolean }[]>`
      INSERT INTO users (telegram_user_id, first_name, last_name, username, last_login_at, updated_at)
      VALUES (${input.telegramUserId}, ${input.firstName}, ${input.lastName}, ${input.username}, ${now}, ${now})
      ON CONFLICT (telegram_user_id) DO UPDATE SET
        first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, username = EXCLUDED.username,
        last_login_at = EXCLUDED.last_login_at, updated_at = EXCLUDED.updated_at
      RETURNING id, (xmax = 0) AS created`;
    if (!row) throw new Error('user upsert returned no row');
    return { user: await this.db.user.findUniqueOrThrow({ where: { id: row.id } }), created: row.created };
  }

  findById(id: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { id } });
  }

  async setStatus(id: string, status: 'active' | 'disabled'): Promise<void> {
    await this.db.user.update({ where: { id }, data: { status } });
  }
}

export interface SessionPolicy {
  absoluteMs: number;
  idleMs: number;
}

export interface ActiveSession {
  session: UserSession;
  user: User;
}

/** Skip writing last-seen more often than this (keeps reads cheap). */
const TOUCH_INTERVAL_MS = 5 * 60_000;

/** Server-side sessions; the table stores only token hashes (ADR-017). */
export class SessionRepository {
  constructor(private readonly db: Database) {}

  create(userId: string, tokenHash: string, userAgent: string | null, policy: SessionPolicy, now: Date = new Date()): Promise<UserSession> {
    const expiresAt = new Date(now.getTime() + policy.absoluteMs);
    const idleExpiresAt = new Date(Math.min(now.getTime() + policy.idleMs, expiresAt.getTime()));
    return this.db.userSession.create({
      data: { userId, tokenHash, userAgent: userAgent ? userAgent.slice(0, 200) : null, createdAt: now, lastSeenAt: now, expiresAt, idleExpiresAt },
    });
  }

  /** A session is active when not revoked, within both limits, and its user is active. */
  async findActive(tokenHash: string, now: Date = new Date()): Promise<ActiveSession | null> {
    const session = await this.db.userSession.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= now || session.idleExpiresAt <= now || session.user.status !== 'active') return null;
    const { user, ...rest } = session;
    return { session: rest, user };
  }

  /** Slides the idle window (never beyond the absolute expiry). */
  async touch(session: UserSession, policy: SessionPolicy, now: Date = new Date()): Promise<void> {
    if (now.getTime() - session.lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return;
    const idleExpiresAt = new Date(Math.min(now.getTime() + policy.idleMs, session.expiresAt.getTime()));
    await this.db.userSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { lastSeenAt: now, idleExpiresAt } });
  }

  async revoke(id: string, now: Date = new Date()): Promise<void> {
    await this.db.userSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } });
  }

  /** Revokes every session of a user (optionally keeping one); returns how many were revoked. */
  async revokeAllForUser(userId: string, exceptId?: string, now: Date = new Date()): Promise<number> {
    const r = await this.db.userSession.updateMany({ where: { userId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) }, data: { revokedAt: now } });
    return r.count;
  }

  /**
   * Object-level revocation: only the owner's own session is affected. Returns false when the
   * session does not exist, is already revoked, or belongs to someone else (callers answer 404).
   */
  async revokeOwned(userId: string, sessionId: string, now: Date = new Date()): Promise<boolean> {
    const r = await this.db.userSession.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: now } });
    return r.count === 1;
  }

  listActive(userId: string, now: Date = new Date()): Promise<UserSession[]> {
    return this.db.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now }, idleExpiresAt: { gt: now } },
      orderBy: { lastSeenAt: 'desc' },
      take: 50,
    });
  }
}
