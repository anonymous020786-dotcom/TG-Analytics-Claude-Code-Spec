import type { Database } from '../client';

/** Roles that must always keep at least one holder (lock-out protection). */
export const PROTECTED_ROLES: ReadonlySet<string> = new Set(['admin']);

export type RevokeOutcome = 'revoked' | 'not_assigned' | 'last_holder';

/**
 * Role assignments and permission lookup (PHASE-17, ADR-018). The role/permission catalog is
 * seeded by migrations; this repository only reads it and manages user-role assignments.
 */
export class RoleRepository {
  constructor(private readonly db: Database) {}

  /** Effective permissions of a user (one query; checked on every privileged request). */
  async permissionsOf(userId: string): Promise<Set<string>> {
    const rows = await this.db.$queryRaw<{ permission_key: string }[]>`
      SELECT DISTINCT rp.permission_key
      FROM user_roles ur JOIN role_permissions rp ON rp.role_key = ur.role_key
      WHERE ur.user_id = ${userId}::uuid`;
    return new Set(rows.map((r) => r.permission_key));
  }

  async rolesOf(userId: string): Promise<string[]> {
    const rows = await this.db.userRole.findMany({ where: { userId }, orderBy: { roleKey: 'asc' }, select: { roleKey: true } });
    return rows.map((r) => r.roleKey);
  }

  /** Every permission key in the catalog (startup check against the code catalog). */
  async permissionKeys(): Promise<string[]> {
    return (await this.db.permission.findMany({ select: { key: true }, orderBy: { key: 'asc' } })).map((p) => p.key);
  }

  async roleExists(key: string): Promise<boolean> {
    return (await this.db.role.count({ where: { key } })) === 1;
  }

  /** Idempotent: returns false when the user already had the role. */
  async grant(userId: string, roleKey: string, grantedBy: string): Promise<boolean> {
    const rows = await this.db.$queryRaw<{ user_id: string }[]>`
      INSERT INTO user_roles (user_id, role_key, granted_by) VALUES (${userId}::uuid, ${roleKey}, ${grantedBy})
      ON CONFLICT (user_id, role_key) DO NOTHING
      RETURNING user_id`;
    return rows.length === 1;
  }

  /**
   * Revokes a role. For protected roles the last holder cannot be removed. The holders' rows
   * are locked first, so two admins removing each other concurrently cannot leave zero admins.
   */
  async revoke(userId: string, roleKey: string): Promise<RevokeOutcome> {
    return this.db.$transaction(async (tx) => {
      const holders = await tx.$queryRaw<{ user_id: string }[]>`
        SELECT user_id FROM user_roles WHERE role_key = ${roleKey} ORDER BY user_id FOR UPDATE`;
      if (!holders.some((h) => h.user_id === userId)) return 'not_assigned';
      if (PROTECTED_ROLES.has(roleKey) && holders.length <= 1) return 'last_holder';
      await tx.userRole.delete({ where: { userId_roleKey: { userId, roleKey } } });
      return 'revoked';
    });
  }
}
