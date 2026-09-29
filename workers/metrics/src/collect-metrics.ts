import { type Observed, TelegramError } from '@tga/adapter-telegram';
import type { ChannelRepository } from '@tga/database';
import { JobError } from '@tga/queues';
import type { AnalyticsStore } from '@tga/types';

export interface MemberCountSource {
  getMemberCount(username: string): Promise<Observed<bigint>>;
}

export interface MetricsDeps {
  channels: ChannelRepository;
  store: AnalyticsStore;
  telegram: MemberCountSource;
}

/** Metric key for subscriber/member counts (DATA-POLICY §4, CAPABILITY-MATRIX §1). */
export const MEMBERS_METRIC = 'members';

/**
 * channel.metrics collector (DATA-FLOW §2): collect → validate → append snapshot → update
 * current value. Idempotent per delivery (the ledger runs each job once); a failed
 * collection is recorded without touching previous observations (FR-DQ-02).
 */
export async function collectMetrics(deps: MetricsDeps, channelId: string, jobId: string): Promise<{ members: bigint; appended: boolean }> {
  const channel = await deps.channels.findById(channelId);
  if (!channel) throw new JobError('permanent', 'channel_not_found', 'Channel no longer exists');
  if (!channel.username) throw new JobError('permanent', 'no_public_username', 'Channel has no current public username');

  try {
    const observed = await deps.telegram.getMemberCount(channel.username);
    const { inserted } = await deps.store.appendChannelSnapshots([
      { entityId: channelId, metric: MEMBERS_METRIC, value: observed.value, observedAt: observed.observedAt, source: observed.source, jobId },
    ]);
    await deps.channels.recordMemberCount(channelId, observed.value, observed.observedAt);
    return { members: observed.value, appended: inserted === 1 };
  } catch (error) {
    const rateLimited = (error as { failureClass?: unknown }).failureClass === 'rate_limited';
    if (!rateLimited) await deps.channels.recordCollectionFailure(channelId);
    if (error instanceof TelegramError && (error.code === 'chat_not_found' || error.code === 'not_public')) {
      await deps.channels.markStatus(channelId, error.code === 'not_public' ? 'not_public' : 'inaccessible');
    }
    throw error;
  }
}
