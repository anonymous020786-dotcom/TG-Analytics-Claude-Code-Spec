import type { Database } from '../client';
import type { AuditLog, Prisma } from '../generated/prisma/client';

export interface AuditEntry {
  actorType: 'system' | 'user';
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  /** Never include secrets or raw credentials. */
  metadata?: Prisma.InputJsonValue;
  requestId?: string;
}

/** Append-only audit trail; the database rejects UPDATE, DELETE and TRUNCATE. */
export class AuditLogRepository {
  constructor(private readonly db: Database) {}

  append(entry: AuditEntry): Promise<AuditLog> {
    return this.db.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
        requestId: entry.requestId ?? null,
      },
    });
  }
}
