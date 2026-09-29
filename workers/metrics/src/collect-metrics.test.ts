import { TelegramError } from '@tga/adapter-telegram';
import { AnomalyRepository, ChannelRepository, createDatabase, PostgresAnalyticsStore } from '@tga/database';
import { JobError } from '@tga/queues';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectMetrics, MEMBERS_METRIC, type MemberCountSource } from './collect-metrics';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL (*_test) is required');
const db = createDatabase({ url, poolMax: 2 });
const channels = new ChannelRepository(db);
const store = new PostgresAnalyticsStore(db);
const anomalies = new AnomalyRepository(db);
const JOB = '01920000-0000-7000-8000-00000000f00d';

const at = (min: number) => new Date(Date.UTC(2026, 8, 28, 10, min));
const source = (...results: (bigint | Error)[]): MemberCountSource => {
  let minute = 0;
  return {
    getMemberCount: vi.fn(async () => {
      const next = results.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error('unexpected call');
      minute += 1;
      return { value: next, observedAt: at(minute), source: 'bot_api' as const };
    }),
  };
};

async function channel(username: string | null = 'telegram') {
  const { channel: c } = await channels.upsertFromTelegram({ telegramId: -1001005640892n, type: 'channel', username: 'telegram', title: 'Telegram News', description: null, observedAt: at(0) });
  if (username === null) await db.channel.update({ where: { id: c.id }, data: { username: null } });
  return c;
}

beforeEach(async () => {
  await db.$executeRawUnsafe('DELETE FROM metric_anomalies');
  await db.$executeRawUnsafe('DELETE FROM channel_metric_snapshots');
  await db.$executeRawUnsafe('TRUNCATE channel_aliases, channels RESTART IDENTITY CASCADE');
});
afterAll(() => db.$disconnect());

describe('collectMetrics', () => {
  it('appends a members snapshot with provenance and updates the current count', async () => {
    const c = await channel();
    const res = await collectMetrics({ channels, store, anomalies, telegram: source(9_443_724n) }, c.id, JOB);

    expect(res).toEqual({ members: 9_443_724n, appended: true, anomalies: [] });
    expect(await store.latestChannelValue(c.id, MEMBERS_METRIC)).toMatchObject({ value: 9_443_724n, source: 'bot_api' });
    expect(await db.channelMetricSnapshot.findFirstOrThrow({ where: { channelId: c.id } })).toMatchObject({ jobId: JOB });
    expect(await channels.findById(c.id)).toMatchObject({ memberCount: 9_443_724n, collectionStatus: 'ok', lastCollectedAt: at(1) });
  });

  it('builds history across runs (append-only)', async () => {
    const c = await channel();
    const telegram = source(100n, 120n);
    await collectMetrics({ channels, store, anomalies, telegram }, c.id, JOB);
    await collectMetrics({ channels, store, anomalies, telegram }, c.id, JOB);
    const series = await store.channelSeries({ entityId: c.id, metric: MEMBERS_METRIC, from: at(0), to: at(59) });
    expect(series.map((p) => p.value)).toEqual([100n, 120n]);
  });

  it('records a failed collection without deleting history', async () => {
    const c = await channel();
    await collectMetrics({ channels, store, anomalies, telegram: source(100n) }, c.id, JOB);
    await expect(collectMetrics({ channels, store, anomalies, telegram: source(new TelegramError('transient', 'timeout', 't')) }, c.id, JOB)).rejects.toThrow();

    expect((await channels.findById(c.id))?.collectionStatus).toBe('failed');
    expect(await db.channelMetricSnapshot.count({ where: { channelId: c.id } })).toBe(1);
  });

  it('does not mark rate limits as collection failures', async () => {
    const c = await channel();
    const limited = new TelegramError('rate_limited', 'too_many_requests', 'x', { retryAfterMs: 1_000 });
    await expect(collectMetrics({ channels, store, anomalies, telegram: source(limited) }, c.id, JOB)).rejects.toBe(limited);
    expect((await channels.findById(c.id))?.collectionStatus).toBe('pending');
  });

  it('marks the channel inaccessible when its username no longer resolves', async () => {
    const c = await channel();
    const gone = new TelegramError('invalid_input', 'chat_not_found', 'chat not found');
    await expect(collectMetrics({ channels, store, anomalies, telegram: source(gone) }, c.id, JOB)).rejects.toBe(gone);
    expect((await channels.findById(c.id))?.status).toBe('inaccessible');
  });

  it('fails permanently for missing channels or channels without a username', async () => {
    await expect(collectMetrics({ channels, store, anomalies, telegram: source() }, '01920000-0000-7000-8000-000000000000', JOB)).rejects.toMatchObject({ failureClass: 'permanent', code: 'channel_not_found' });
    const c = await channel(null);
    const err = await collectMetrics({ channels, store, anomalies, telegram: source() }, c.id, JOB).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobError);
    expect((err as JobError).code).toBe('no_public_username');
  });

  it('flags a member-count crash as an anomaly but keeps the raw observation (PHASE-10)', async () => {
    const c = await channel();
    const telegram = source(50_000n, 0n);
    await collectMetrics({ channels, store, anomalies, telegram }, c.id, JOB);
    const res = await collectMetrics({ channels, store, anomalies, telegram }, c.id, JOB);

    expect(res.anomalies).toEqual(['drop_to_zero']);
    expect(await store.latestChannelValue(c.id, MEMBERS_METRIC)).toMatchObject({ value: 0n });
    expect(await db.metricAnomaly.findFirstOrThrow({ where: { channelId: c.id } })).toMatchObject({ rule: 'drop_to_zero', previousValue: 50_000n, value: 0n });
  });

  it('rejects implausible values before storing and records the failure class', async () => {
    const c = await channel();
    const err = await collectMetrics({ channels, store, anomalies, telegram: source(20_000_000_000n) }, c.id, JOB).catch((e: unknown) => e);
    expect(err).toMatchObject({ failureClass: 'invalid_input', code: 'implausible_implausibly_large' });
    expect(await db.channelMetricSnapshot.count({ where: { channelId: c.id } })).toBe(0);
    expect(await channels.qualityView(c.id)).toMatchObject({ collectionStatus: 'failed', lastCollectionErrorClass: 'invalid_input' });
  });

  it('clears the failure class on the next successful collection', async () => {
    const c = await channel();
    await collectMetrics({ channels, store, anomalies, telegram: source(new TelegramError('transient', 'timeout', 't')) }, c.id, JOB).catch(() => undefined);
    expect((await channels.qualityView(c.id))?.lastCollectionErrorClass).toBe('transient');
    await collectMetrics({ channels, store, anomalies, telegram: source(100n) }, c.id, JOB);
    expect(await channels.qualityView(c.id)).toMatchObject({ collectionStatus: 'ok', lastCollectionErrorClass: null });
  });
});
