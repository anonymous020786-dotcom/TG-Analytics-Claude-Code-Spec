import type { Database } from '../client';

/**
 * Named expiring locks (PHASE-09): scheduler singleton and per-entity collection locks.
 * Acquire succeeds when the lease is free, expired, or already held by the same owner
 * (renewal). Expiry bounds how long a crashed holder can block others.
 */
export class LeaseRepository {
  constructor(private readonly db: Database) {}

  async acquire(key: string, owner: string, ttlMs: number): Promise<boolean> {
    const ttl = Math.min(Math.max(1_000, Math.trunc(ttlMs)), 86_400_000);
    const rows = await this.db.$queryRaw<{ owner: string }[]>`
      INSERT INTO leases (key, owner, expires_at, updated_at)
      VALUES (${key}, ${owner}, now() + (${ttl} * interval '1 millisecond'), now())
      ON CONFLICT (key) DO UPDATE
        SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at, updated_at = now()
        WHERE leases.expires_at < now() OR leases.owner = EXCLUDED.owner
      RETURNING owner`;
    return rows.length === 1;
  }

  /** Releases only a lease this owner holds. */
  async release(key: string, owner: string): Promise<void> {
    await this.db.lease.deleteMany({ where: { key, owner } });
  }
}
