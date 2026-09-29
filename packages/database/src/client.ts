import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export interface DatabaseOptions {
  /** PostgreSQL connection string (a secret: never log it). */
  url: string;
  /** Max pooled connections per process. */
  poolMax?: number;
  /** Fail fast when no connection can be obtained (CLAUDE.md: external calls need timeouts). */
  connectionTimeoutMs?: number;
  /** Server-side cap on any single statement. */
  statementTimeoutMs?: number;
}

/**
 * Provisional defaults until OD-005 sets capacity targets; processes override them
 * through their own config schema when they start using the database.
 */
export const DATABASE_DEFAULTS = {
  poolMax: 10,
  connectionTimeoutMs: 5_000,
  statementTimeoutMs: 15_000,
} as const;

export type Database = PrismaClient;

export function createDatabase(options: DatabaseOptions): Database {
  const adapter = new PrismaPg({
    connectionString: options.url,
    max: options.poolMax ?? DATABASE_DEFAULTS.poolMax,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? DATABASE_DEFAULTS.connectionTimeoutMs,
    statement_timeout: options.statementTimeoutMs ?? DATABASE_DEFAULTS.statementTimeoutMs,
  });
  return new PrismaClient({ adapter });
}
