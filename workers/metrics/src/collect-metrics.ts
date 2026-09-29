import { type Observed, TelegramError } from '@tga/adapter-telegram';
import { type AnomalyThresholds, checkPlausibility, DEFAULT_ANOMALY_THRESHOLDS, detectAnomalies } from '@tga/analytics';
import type { AnomalyRepository, ChannelRepository } from '@tga/database';
import { JobError } from '@tga/queues';
import { type AnalyticsStore, FAILURE_CLASSES, type FailureClass } from '@tga/types';

export interface MemberCountSource {
  getMemberCount(username: string): Promise<Observed<bigint>>;
}

export interface MetricsDeps {
  channels: ChannelRepository;
  store: AnalyticsStore;
  anomalies: AnomalyRepository;
  telegram: MemberCountSource;
  thresholds?: AnomalyThresholds;
  now?: () => Date;
}

/** Metric key for subscriber/member counts (DATA-POLICY §4, CAPABILITY-MATRIX §1). */
export const MEMBERS_METRIC = 'members';

export interface MetricsResult {
  members: bigint;
  appended: boolean;
  anomalies: string[];
}

/**
 * channel.metrics collector (DATA-FLOW §2): collect → validate (plausibility) → append
 * snapshot → flag anomalies (PHASE-10) → update current value. The raw observation is always
 * kept; anomalies only annotate it. A failed collection records its failure class without
 * touching previous observations (FR-DQ-01/02).
 */
export async function collectMetrics(deps: MetricsDeps, channelId: string, jobId: string): Promise<MetricsResult> {
  const channel = await deps.channels.findById(channelId);
  if (!channel) throw new JobError('permanent', 'channel_not_found', 'Channel no longer exists');
  if (!channel.username) throw new JobError('permanent', 'no_public_username', 'Channel has no current public username');

  try {
    const observed = await deps.telegram.getMemberCount(channel.username);
    const plausible = checkPlausibility(observed.value, observed.observedAt, deps.now?.() ?? new Date());
    if (!plausible.ok) throw new JobError('invalid_input', `implausible_${plausible.reason}`, 'Telegram returned an implausible member count');

    const previous = await deps.store.latestChannelValue(channelId, MEMBERS_METRIC);
    const { inserted } = await deps.store.appendChannelSnapshots([
      { entityId: channelId, metric: MEMBERS_METRIC, value: observed.value, observedAt: observed.observedAt, source: observed.source, jobId },
    ]);
    const anomalies = inserted === 1 ? detectAnomalies(previous, { value: observed.value, observedAt: observed.observedAt }, deps.thresholds ?? DEFAULT_ANOMALY_THRESHOLDS) : [];
    await deps.anomalies.record(channelId, MEMBERS_METRIC, observed.observedAt, anomalies);
    await deps.channels.recordMemberCount(channelId, observed.value, observed.observedAt);
    return { members: observed.value, appended: inserted === 1, anomalies: anomalies.map((a) => a.rule) };
  } catch (error) {
    const failureClass = classOf(error);
    if (failureClass !== 'rate_limited') await deps.channels.recordCollectionFailure(channelId, failureClass);
    if (error instanceof TelegramError && (error.code === 'chat_not_found' || error.code === 'not_public')) {
      await deps.channels.markStatus(channelId, error.code === 'not_public' ? 'not_public' : 'inaccessible');
    }
    throw error;
  }
}

function classOf(error: unknown): FailureClass {
  const cls = (error as { failureClass?: unknown })?.failureClass;
  return typeof cls === 'string' && (FAILURE_CLASSES as readonly string[]).includes(cls) ? (cls as FailureClass) : 'unknown';
}
