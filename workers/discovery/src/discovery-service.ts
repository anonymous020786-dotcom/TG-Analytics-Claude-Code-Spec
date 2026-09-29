import { CAPABILITIES, type Observed, TelegramError, type TelegramEntity } from '@tga/adapter-telegram';
import type { ChannelRepository, ChannelStatus, JobRepository } from '@tga/database';
import { normalizeTelegramReference, type ReferenceRejection } from '@tga/validation';

/** The adapter surface discovery needs (TelegramClientAdapter satisfies it). */
export interface PublicEntityResolver {
  resolvePublicEntity(username: string): Promise<Observed<TelegramEntity>>;
}

/** Follow-up queues scheduled after a successful discovery (DATA-FLOW.md §1). */
export const FOLLOW_UP_QUEUES = ['channel.metadata', 'channel.metrics', 'channel.posts', 'search.index'] as const;
export type FollowUpQueue = (typeof FOLLOW_UP_QUEUES)[number];

export interface DiscoveryOptions {
  /** Bounded attempts for follow-up jobs (provisional until PHASE-09 sets retry policy). */
  followUpMaxAttempts?: number;
  /** channel.posts requires the MTProto capability (CAPABILITY-MATRIX); off until verified. */
  postsEnabled?: boolean;
}

export type DiscoveryOutcome =
  | {
      status: 'indexed';
      channelId: string;
      username: string;
      created: boolean;
      previousUsername: string | null;
      stale: boolean;
      scheduled: FollowUpQueue[];
    }
  | { status: 'rejected'; reason: ReferenceRejection | 'not_public' | 'not_found' };

export interface DiscoveryContext {
  traceId?: string;
}

/**
 * DISCOVERY.md: normalize → validate → resolve → public-scope check → map → upsert → schedule.
 * Idempotent: re-running the same discovery converges on the same channel and never
 * duplicates follow-up jobs. Retryable Telegram failures (rate limits, timeouts,
 * authorization) are rethrown for the job layer to reschedule (PHASE-08/09).
 */
export class DiscoveryService {
  private readonly followUpMaxAttempts: number;
  private readonly postsEnabled: boolean;

  constructor(
    private readonly resolver: PublicEntityResolver,
    private readonly channels: ChannelRepository,
    private readonly jobs: JobRepository,
    options: DiscoveryOptions = {},
  ) {
    this.followUpMaxAttempts = options.followUpMaxAttempts ?? 5;
    this.postsEnabled = options.postsEnabled ?? CAPABILITIES.recentPosts.verified;
  }

  async discover(input: string, context: DiscoveryContext = {}): Promise<DiscoveryOutcome> {
    const normalized = normalizeTelegramReference(input);
    if (!normalized.ok) return { status: 'rejected', reason: normalized.reason };
    const { username } = normalized;

    let observed: Observed<TelegramEntity>;
    try {
      observed = await this.resolver.resolvePublicEntity(username);
    } catch (error) {
      const rejection = this.rejectionFor(error);
      if (!rejection) throw error;
      await this.markKnownChannel(username, rejection.status);
      return { status: 'rejected', reason: rejection.reason };
    }

    const entity = observed.value;
    const result = await this.channels.upsertFromTelegram({
      telegramId: entity.telegramId,
      type: entity.type,
      username: entity.username,
      title: entity.title,
      description: entity.description,
      ...(entity.isVerified === undefined ? {} : { isVerified: entity.isVerified }),
      ...(entity.isScam === undefined ? {} : { isScam: entity.isScam }),
      observedAt: observed.observedAt,
    });

    const scheduled: FollowUpQueue[] = [];
    for (const queue of FOLLOW_UP_QUEUES) {
      if (queue === 'channel.posts' && !this.postsEnabled) continue;
      const { created } = await this.jobs.enqueue({
        queue,
        type: 'initial',
        idempotencyKey: `discovered:${result.channel.id}`,
        payloadVersion: 1,
        payload: { channelId: result.channel.id },
        entityId: result.channel.id,
        maxAttempts: this.followUpMaxAttempts,
        ...(context.traceId ? { traceId: context.traceId } : {}),
      });
      if (created) scheduled.push(queue);
    }

    return {
      status: 'indexed',
      channelId: result.channel.id,
      username: result.channel.username ?? entity.username,
      created: result.created,
      previousUsername: result.previousUsername,
      stale: result.stale,
      scheduled,
    };
  }

  /** Scope rejections are final (no retry); anything else is returned as null and rethrown. */
  private rejectionFor(error: unknown): { reason: 'not_public' | 'not_found'; status: ChannelStatus } | null {
    if (!(error instanceof TelegramError)) return null;
    if (error.code === 'not_public') return { reason: 'not_public', status: 'not_public' };
    if (error.code === 'chat_not_found') return { reason: 'not_found', status: 'inaccessible' };
    return null;
  }

  /** A known channel whose username no longer resolves keeps its history (DATA-POLICY §6). */
  private async markKnownChannel(username: string, status: ChannelStatus): Promise<void> {
    const known = await this.channels.findByUsername(username);
    if (known && known.username === username) await this.channels.markStatus(known.id, status);
  }
}
