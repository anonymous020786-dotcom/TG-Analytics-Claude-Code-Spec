import type { Database } from '../client';
import type { Post } from '../generated/prisma/client';
import { clampLimit, decodeCursor, toPage, type Page } from '../pagination';

export interface ListPostsInput {
  channelId: string;
  cursor?: string;
  limit?: number;
}

export class PostRepository {
  constructor(private readonly db: Database) {}

  /** Newest first; keyset pagination on (posted_at, id), backed by posts_channel_id_posted_at_id_idx. */
  async listByChannel(input: ListPostsInput): Promise<Page<Post>> {
    const limit = clampLimit(input.limit);
    const c = input.cursor ? decodeCursor(input.cursor, { postedAt: 'date', id: 'uuid' }) : undefined;
    const rows = await this.db.post.findMany({
      where: {
        channelId: input.channelId,
        ...(c
          ? {
              OR: [
                { postedAt: { lt: new Date(c.postedAt) } },
                { postedAt: new Date(c.postedAt), id: { lt: c.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return toPage(rows, limit, (last) => ({ postedAt: last.postedAt.toISOString(), id: last.id }));
  }
}
