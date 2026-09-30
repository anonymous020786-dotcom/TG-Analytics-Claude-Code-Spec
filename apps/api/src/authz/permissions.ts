/**
 * Permission catalog used by the API (PHASE-17, ADR-018). Keys must exist in the `permissions`
 * table (seeded by migrations); `assertCatalog` checks this at startup so a typo or a missing
 * migration fails loudly instead of silently denying (or granting) access.
 */
export const PERMISSIONS = {
  ROLES_MANAGE: 'roles.manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export async function assertCatalog(knownKeys: () => Promise<string[]>): Promise<void> {
  const known = new Set(await knownKeys());
  const missing = Object.values(PERMISSIONS).filter((p) => !known.has(p));
  if (missing.length > 0) throw new Error(`permissions missing from the database (run migrations): ${missing.join(', ')}`);
}
