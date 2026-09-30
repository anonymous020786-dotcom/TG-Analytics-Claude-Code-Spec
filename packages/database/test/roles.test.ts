import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RoleRepository, SessionRepository, UserRepository } from '../src';
import { testDb } from './helpers';

const db = testDb();
const users = new UserRepository(db);
const roles = new RoleRepository(db);
const sessions = new SessionRepository(db);
let tg = 5_000n;

async function user(name = 'U') {
  tg += 1n;
  return (await users.upsertFromTelegram({ telegramUserId: tg, firstName: name, lastName: null, username: null })).user;
}

beforeEach(() => db.$executeRawUnsafe('TRUNCATE user_roles, user_sessions, users RESTART IDENTITY CASCADE'));
afterAll(() => db.$disconnect());

describe('RoleRepository', () => {
  it('has the seeded catalog: admin holds roles.manage', async () => {
    expect(await roles.roleExists('admin')).toBe(true);
    expect(await roles.roleExists('superuser')).toBe(false);
    const u = await user();
    expect(await roles.permissionsOf(u.id)).toEqual(new Set());
    expect(await roles.grant(u.id, 'admin', 'ops-test')).toBe(true);
    expect(await roles.grant(u.id, 'admin', 'ops-test')).toBe(false); // idempotent
    expect(await roles.permissionsOf(u.id)).toEqual(new Set(['roles.manage']));
    expect(await roles.rolesOf(u.id)).toEqual(['admin']);
  });

  it('refuses unknown roles at the database (foreign key)', async () => {
    const u = await user();
    await expect(roles.grant(u.id, 'superuser', 'ops-test')).rejects.toThrow();
  });

  it('never removes the last admin, even under concurrent revocations', async () => {
    const [a, b] = [await user('A'), await user('B')];
    await roles.grant(a.id, 'admin', 'ops-test');
    await roles.grant(b.id, 'admin', 'ops-test');
    const outcomes = await Promise.all([roles.revoke(a.id, 'admin'), roles.revoke(b.id, 'admin')]);
    expect(outcomes.sort()).toEqual(['last_holder', 'revoked']);
    expect(await db.userRole.count({ where: { roleKey: 'admin' } })).toBe(1);
    expect(await roles.revoke(a.id === (await db.userRole.findFirst())?.userId ? b.id : a.id, 'admin')).toBe('not_assigned');
  });
});

describe('SessionRepository.revokeOwned (object-level)', () => {
  it('revokes only the owner\'s session', async () => {
    const [a, b] = [await user('A'), await user('B')];
    const policy = { absoluteMs: 86_400_000, idleMs: 86_400_000 };
    const sb = await sessions.create(b.id, 'b'.repeat(64), null, policy);
    expect(await sessions.revokeOwned(a.id, sb.id)).toBe(false); // A cannot touch B's session
    expect(await sessions.findActive('b'.repeat(64))).not.toBeNull();
    expect(await sessions.revokeOwned(b.id, sb.id)).toBe(true);
    expect(await sessions.revokeOwned(b.id, sb.id)).toBe(false); // already revoked
  });
});
