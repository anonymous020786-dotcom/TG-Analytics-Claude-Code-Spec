import type { Database } from '../client';
import type { Channel } from '../generated/prisma/client';
import { clampLimit, decodeCursor, toPage, type Page } from '../pagination';

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
