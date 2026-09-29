import type { Database } from '../client';
import type { FailureClass } from '@tga/types';
import { type Channel, Prisma } from '../generated/prisma/client';
import { clampLimit, decodeCursor, toPage, type Page } from '../pagination';

/** Public entity as resolved from Telegram (mapped by the adapter). */
export interface TelegramEntityInput {
  telegramId: bigint;
  type: 'channel' | 'group';
  username: string;
  title: string;
  description: string | null;
  isVerified?: boolean;
  isScam?: boolean;
  observedAt: Date;
}

export interface UpsertResult {
  channel: Channel;
  created: boolean;
  /** Previous current username when it changed (now kept as an alias). */
  previousUsername: string | null;
  /** True when the observation was older than stored metadata and did not overwrite it. */
  stale: boolean;
}

export interface ChannelQualityView {
  id: string;
  status: string;
  collectionStatus: string;
  lastCollectionErrorClass: string | null;
  lastCollectedAt: Date | null;
  memberCountObservedAt: Date | null;
  metadataObservedAt: Date | null;
}

/** Telegram-side availability (DATA-POLICY §6). History is always kept. */
export type ChannelStatus = 'active' | 'not_public' | 'deleted' | 'inaccessible';

const UPSERT_ATTEMPTS = 3;

function isRetryableConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034');
}

/** Usernames are stored lowercase without "@" (schema CHECK). */
export function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, '').toLowerCase();
}

export interface ListChannelsInput {
  cursor?: string;
  limit?: number;
  /** Moderator-hidden entities are excluded unless explicitly requested (FR-MOD-01). */
  includeHidden?: boolean;
}

/**
 * Persistence access for channels/groups. Identity rules (upsert by Telegram ID,
 * alias creation on username change) belong to discovery (PHASE-07).
 */
export class ChannelRepository {
  constructor(private readonly db: Database) {}

  findById(id: string): Promise<Channel | null> {
    return this.db.channel.findUnique({ where: { id } });
  }

  findByTelegramId(telegramId: bigint): Promise<Channel | null> {
    return this.db.channel.findUnique({ where: { telegramId } });
  }

  /** Current username first, then the most recently seen alias. */
  async findByUsername(username: string): Promise<Channel | null> {
    const name = normalizeUsername(username);
    const current = await this.db.channel.findUnique({ where: { username: name } });
    if (current) return current;
    const alias = await this.db.channelAlias.findFirst({
      where: { username: name },
      orderBy: { lastSeenAt: 'desc' },
      include: { channel: true },
    });
    return alias?.channel ?? null;
  }

  /**
   * Canonical-identity upsert (DISCOVERY.md). Stable Telegram ID is the identity; every
   * username seen becomes an alias; a stale holder of the same username (it changed hands)
   * is released. Older observations never overwrite newer metadata. Concurrent calls for the
   * same entity converge on one row (bounded retry on unique/serialization conflicts).
   */
  async upsertFromTelegram(input: TelegramEntityInput): Promise<UpsertResult> {
    const username = normalizeUsername(input.username);
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.db.$transaction(async (tx) => {
          const existing = await tx.channel.findUnique({ where: { telegramId: input.telegramId } });
          const stale = !!existing?.metadataObservedAt && existing.metadataObservedAt > input.observedAt;

          if (!stale) {
            const holder = await tx.channel.findUnique({ where: { username } });
            if (holder && holder.telegramId !== input.telegramId) {
              await tx.channel.update({ where: { id: holder.id }, data: { username: null } });
            }
          }

          const data = {
            type: input.type,
            username,
            title: input.title,
            description: input.description,
            status: 'active',
            metadataObservedAt: input.observedAt,
            ...(input.isVerified === undefined ? {} : { isVerified: input.isVerified }),
            ...(input.isScam === undefined ? {} : { isScam: input.isScam }),
          };
          const channel = existing
            ? stale
              ? existing
              : await tx.channel.update({ where: { id: existing.id }, data })
            : await tx.channel.create({ data: { telegramId: input.telegramId, ...data } });

          // Alias history: widen [first_seen_at, last_seen_at] to include this observation.
          await tx.channelAlias.upsert({
            where: { channelId_username: { channelId: channel.id, username } },
            create: { channelId: channel.id, username, firstSeenAt: input.observedAt, lastSeenAt: input.observedAt },
            update: {},
          });
          await tx.channelAlias.updateMany({
            where: { channelId: channel.id, username, lastSeenAt: { lt: input.observedAt } },
            data: { lastSeenAt: input.observedAt },
          });
          await tx.channelAlias.updateMany({
            where: { channelId: channel.id, username, firstSeenAt: { gt: input.observedAt } },
            data: { firstSeenAt: input.observedAt },
          });

          const previousUsername = existing && !stale && existing.username && existing.username !== username ? existing.username : null;
          return { channel, created: !existing, previousUsername, stale };
        });
      } catch (error) {
        if (!isRetryableConflict(error) || attempt >= UPSERT_ATTEMPTS) throw error;
      }
    }
  }

  /**
   * Current member count + successful collection (DATA-FLOW §2 step 5). Only an observation
   * newer than the stored one updates the count; returns false when it was stale.
   */
  async recordMemberCount(channelId: string, count: bigint, observedAt: Date): Promise<boolean> {
    const { count: updated } = await this.db.channel.updateMany({
      where: { id: channelId, OR: [{ memberCountObservedAt: null }, { memberCountObservedAt: { lt: observedAt } }] },
      data: { memberCount: count, memberCountObservedAt: observedAt, lastCollectedAt: observedAt, collectionStatus: 'ok', lastCollectionErrorClass: null },
    });
    return updated === 1;
  }

  /** Collection failed: record it and why; previous observations stay untouched (FR-DQ-02). */
  async recordCollectionFailure(channelId: string, errorClass: FailureClass = 'unknown'): Promise<void> {
    await this.db.channel.updateMany({ where: { id: channelId }, data: { collectionStatus: 'failed', lastCollectionErrorClass: errorClass } });
  }

  /** Data-quality view of one channel (FR-DQ-01): collection status, cause and observation times. */
  async qualityView(channelId: string): Promise<ChannelQualityView | null> {
    return this.db.channel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        status: true,
        collectionStatus: true,
        lastCollectionErrorClass: true,
        lastCollectedAt: true,
        memberCountObservedAt: true,
        metadataObservedAt: true,
      },
    });
  }

  /**
   * Scheduler input: ids of active, visible, public channels whose last successful
   * collection of `kind` is older than `olderThan` (or never happened). Keyset-paginated.
   */
  async dueForCollection(kind: 'metrics' | 'metadata', olderThan: Date, afterId: string | undefined, limit: number): Promise<string[]> {
    const field = kind === 'metrics' ? 'lastCollectedAt' : 'metadataObservedAt';
    const rows = await this.db.channel.findMany({
      where: {
        status: 'active',
        hiddenAt: null,
        username: { not: null },
        OR: [{ [field]: null }, { [field]: { lt: olderThan } }],
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: Math.min(Math.max(1, Math.trunc(limit)), 500),
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Record a Telegram-side status change without touching history (DATA-POLICY §6). */
  async markStatus(channelId: string, status: ChannelStatus): Promise<void> {
    await this.db.channel.update({ where: { id: channelId }, data: { status } });
  }

  /** Stable order by id (UUID v7 is time-ordered). */
  async list(input: ListChannelsInput = {}): Promise<Page<Channel>> {
    const limit = clampLimit(input.limit);
    const after = input.cursor ? decodeCursor(input.cursor, { id: 'uuid' }).id : undefined;
    const rows = await this.db.channel.findMany({
      where: {
        ...(input.includeHidden ? {} : { hiddenAt: null }),
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    return toPage(rows, limit, (last) => ({ id: last.id }));
  }
}
