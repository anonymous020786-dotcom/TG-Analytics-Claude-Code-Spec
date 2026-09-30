import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SessionRepository, UserRepository } from '../src';
import { testDb } from './helpers';

const db = testDb();
const users = new UserRepository(db);
const sessions = new SessionRepository(db);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const policy = { absoluteMs: 30 * DAY, idleMs: 7 * DAY };
const t0 = new Date('2026-09-30T12:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);
const hash = (c: string) => c.repeat(64);

beforeEach(() => db.$executeRawUnsafe('TRUNCATE user_sessions, users RESTART IDENTITY CASCADE'));
afterAll(() => db.$disconnect());

describe('UserRepository.upsertFromTelegram', () => {
  it('creates on first sign-in and refreshes display fields afterwards', async () => {
    const a = await users.upsertFromTelegram({ telegramUserId: 777n, firstName: 'Ada', lastName: null, username: 'ada' }, t0);
    expect(a.created).toBe(true);
    const b = await users.upsertFromTelegram({ telegramUserId: 777n, firstName: 'Ada L', lastName: 'Lovelace', username: null }, at(DAY));
    expect(b.created).toBe(false);
    expect(b.user).toMatchObject({ id: a.user.id, firstName: 'Ada L', lastName: 'Lovelace', username: null, lastLoginAt: at(DAY) });
    expect(await db.user.count()).toBe(1);
  });

  it('enforces data constraints in the database', async () => {
    await expect(users.upsertFromTelegram({ telegramUserId: 0n, firstName: 'x', lastName: null, username: null })).rejects.toThrow();
    await expect(users.upsertFromTelegram({ telegramUserId: 5n, firstName: 'x', lastName: null, username: 'Bad Name' })).rejects.toThrow();
  });
});

describe('SessionRepository', () => {
  async function user() {
    return (await users.upsertFromTelegram({ telegramUserId: 42n, firstName: 'Bob', lastName: null, username: 'bob' }, t0)).user;
  }

  it('is active within both limits, not after idle or absolute expiry', async () => {
    const u = await user();
    await sessions.create(u.id, hash('a'), 'Mozilla/5.0', policy, t0);
    expect((await sessions.findActive(hash('a'), at(DAY)))?.user.id).toBe(u.id);
    expect(await sessions.findActive(hash('a'), at(7 * DAY + 1))).toBeNull(); // idle
    expect(await sessions.findActive(hash('b'), at(DAY))).toBeNull(); // unknown
  });

  it('slides the idle window on use but never past the absolute expiry', async () => {
    const u = await user();
    const s = await sessions.create(u.id, hash('a'), null, policy, t0);
    let cur = s;
    for (let d = 6; d < 36; d += 6) {
      await sessions.touch(cur, policy, at(d * DAY));
      const active = await sessions.findActive(hash('a'), at(d * DAY));
      if (d * DAY >= policy.absoluteMs) expect(active).toBeNull();
      else cur = active!.session;
    }
    const row = await db.userSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.idleExpiresAt.getTime()).toBeLessThanOrEqual(row.expiresAt.getTime());
    expect(await sessions.findActive(hash('a'), at(30 * DAY))).toBeNull(); // absolute
  });

  it('revokes one or all sessions, and a disabled user has none', async () => {
    const u = await user();
    const s1 = await sessions.create(u.id, hash('a'), null, policy, t0);
    await sessions.create(u.id, hash('b'), null, policy, t0);
    await sessions.create(u.id, hash('c'), null, policy, t0);
    await sessions.revoke(s1.id, at(MIN));
    expect(await sessions.findActive(hash('a'), at(2 * MIN))).toBeNull();
    const keep = (await sessions.findActive(hash('b'), at(2 * MIN)))!.session;
    expect(await sessions.revokeAllForUser(u.id, keep.id, at(3 * MIN))).toBe(1);
    expect((await sessions.listActive(u.id, at(4 * MIN))).map((s) => s.id)).toEqual([keep.id]);
    await users.setStatus(u.id, 'disabled');
    expect(await sessions.findActive(hash('b'), at(5 * MIN))).toBeNull();
  });

  it('stores only well-formed hashes and truncates user agents', async () => {
    const u = await user();
    await expect(sessions.create(u.id, 'plaintext-token', null, policy, t0)).rejects.toThrow();
    const s = await sessions.create(u.id, hash('d'), 'x'.repeat(500), policy, t0);
    expect(s.userAgent).toHaveLength(200);
  });
});
