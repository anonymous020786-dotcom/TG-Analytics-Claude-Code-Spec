import type { Database } from '../client';
import { Prisma, type RankingRun } from '../generated/prisma/client';
import { clampLimit, decodeCursor, toPage, type Page } from '../pagination';

export interface SaveRankingRunInput {
  rankingKey: string;
  methodologyVersion: string;
  asOf: Date;
  eligibleCount: number;
  entries: readonly { position: number; channelId: string; score: number }[];
}

export interface RankingEntryView {
  position: number;
  channelId: string;
  score: number;
}

/** Computed rankings (PHASE-11): immutable runs, idempotent per (ranking, version, asOf). */
export class RankingRepository {
  constructor(private readonly db: Database) {}

  async saveRun(input: SaveRankingRunInput): Promise<{ runId: string; created: boolean }> {
    if (input.entries.some((e) => !Number.isFinite(e.score) || !Number.isInteger(e.position) || e.position < 1)) {
      throw new RangeError('ranking entries need finite scores and positive integer positions');
    }
    try {
      const run = await this.db.$transaction(async (tx) => {
        const r = await tx.rankingRun.create({
          data: {
            rankingKey: input.rankingKey,
            methodologyVersion: input.methodologyVersion,
            asOf: input.asOf,
            eligibleCount: input.eligibleCount,
            entryCount: input.entries.length,
          },
        });
        if (input.entries.length) {
          await tx.rankingSnapshot.createMany({
            data: input.entries.map((e) => ({ runId: r.id, position: e.position, channelId: e.channelId, score: e.score })),
          });
        }
        return r;
      });
      return { runId: run.id, created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.db.rankingRun.findUniqueOrThrow({
          where: {
            rankingKey_methodologyVersion_asOf: { rankingKey: input.rankingKey, methodologyVersion: input.methodologyVersion, asOf: input.asOf },
          },
        });
        return { runId: existing.id, created: false };
      }
      throw error;
    }
  }

  latestRun(rankingKey: string): Promise<RankingRun | null> {
    return this.db.rankingRun.findFirst({ where: { rankingKey }, orderBy: { asOf: 'desc' } });
  }

  /** Entries of a run by position, cursor-paginated. */
  async entries(runId: string, input: { cursor?: string; limit?: number } = {}): Promise<Page<RankingEntryView>> {
    const limit = clampLimit(input.limit);
    const after = input.cursor ? Number(decodeCursor(input.cursor, { position: 'int' }).position) : 0;
    const rows = await this.db.rankingSnapshot.findMany({
      where: { runId, position: { gt: after } },
      orderBy: { position: 'asc' },
      take: limit + 1,
      select: { position: true, channelId: true, score: true },
    });
    return toPage(rows, limit, (last) => ({ position: String(last.position) }));
  }
}
