import { ChannelRepository, createDatabase, JobRepository, LeaseRepository } from '@tga/database';
import { QUEUES } from '@tga/queues';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { type Schedule, scheduleTick } from './scheduler';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL (*_test) is required');
const db = createDatabase({ url, poolMax: 2 });
const deps = { leases: new LeaseRepository(db), channels: new ChannelRepository(db), jobs: new JobRepository(db) };

const HOUR = 3_600_000;
const now = new Date('2026-09-28T12:00:00Z');
const schedules: Schedule[] = [
  { queue: QUEUES.metrics, kind: 'metrics', intervalMs: 6 * HOUR },
  { queue: QUEUES.metadata, kind: 'metadata', intervalMs: 24 * HOUR },
];
const tick = (owner = 'a', at = now) => scheduleTick(deps, { owner, schedules, now: at, leaseTtlMs: 60_000 });

let tid = 0n;
async function channel(overrides: Partial<{ lastCollectedAt: Date | null; metadataObservedAt: Date | null; status: string; hiddenAt: Date | null; username: string | null }> = {}) {
  tid += 1n;
  return db.channel.create({
    data: { telegramId: -1000000000000n - tid, type: 'channel', username: `chan_${tid}`, title: `C${tid}`, lastCollectedAt: null, metadataObservedAt: null, ...overrides },
  });
}

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE channel_aliases, channels, dead_letter_jobs, job_attempts, jobs, leases RESTART IDENTITY CASCADE');
});
afterAll(() => db.$disconnect());

describe('scheduleTick', () => {
  it('enqueues due channels for both schedules, and skips fresh, hidden, inactive and username-less ones', async () => {
    const due = await channel();
    const fresh = await channel({ lastCollectedAt: new Date(now.getTime() - HOUR), metadataObservedAt: new Date(now.getTime() - HOUR) });
    await channel({ hiddenAt: now });
    await channel({ status: 'inaccessible' });
    await channel({ username: null });

    const r = await tick();
    expect(r).toEqual({ acquired: true, enqueued: { [QUEUES.metrics]: 1, [QUEUES.metadata]: 1 } });
    const jobs = await db.job.findMany();
    expect(jobs.every((j) => j.entityId === due.id && j.type === 'scheduled')).toBe(true);
    expect(jobs.some((j) => j.entityId === fresh.id)).toBe(false);
  });

  it('is idempotent within a window and does not stack jobs for the same entity', async () => {
    await channel();
    await tick();
    expect((await tick()).enqueued).toEqual({ [QUEUES.metrics]: 0, [QUEUES.metadata]: 0 });
    // Next window, but the previous job is still queued: per-entity exclusion.
    expect((await tick('a', new Date(now.getTime() + 7 * HOUR))).enqueued[QUEUES.metrics]).toBe(0);
    expect(await db.job.count()).toBe(2);
  });

  it('schedules again in a later window once the previous job finished', async () => {
    const c = await channel();
    await tick();
    await db.job.updateMany({ data: { status: 'succeeded' } });
    await db.channel.update({ where: { id: c.id }, data: { lastCollectedAt: now } });
    expect((await tick('a', new Date(now.getTime() + 7 * HOUR))).enqueued[QUEUES.metrics]).toBe(1);
  });

  it('runs as a singleton: a second instance cannot tick while the lease is held', async () => {
    await channel();
    expect((await tick('a')).acquired).toBe(true);
    expect(await tick('b')).toEqual({ acquired: false, enqueued: {} });
    await db.lease.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
    expect((await tick('b')).acquired).toBe(true);
  });

  it('enqueues each ranking once per window with the window boundary as asOf', async () => {
    const rankings = { keys: ['top-subscribers', 'trending'], intervalMs: HOUR };
    const r = await scheduleTick(deps, { owner: 'a', schedules: [], now: new Date('2026-09-28T12:34:00Z'), leaseTtlMs: 60_000, rankings });
    expect(r.enqueued[QUEUES.ranking]).toBe(2);
    const again = await scheduleTick(deps, { owner: 'a', schedules: [], now: new Date('2026-09-28T12:59:00Z'), leaseTtlMs: 60_000, rankings });
    expect(again.enqueued[QUEUES.ranking]).toBe(0);
    const jobs = await db.job.findMany({ where: { queue: QUEUES.ranking }, orderBy: { idempotencyKey: 'asc' } });
    expect(jobs.map((j) => j.payload)).toEqual([
      { ranking: 'top-subscribers', asOf: '2026-09-28T12:00:00.000Z' },
      { ranking: 'trending', asOf: '2026-09-28T12:00:00.000Z' },
    ]);
  });

  it('bounds work per tick and pages through many channels', async () => {
    for (let i = 0; i < 12; i += 1) await channel();
    const r = await scheduleTick(deps, { owner: 'a', schedules: [schedules[0]!], now, leaseTtlMs: 60_000, batchSize: 5, maxPerTick: 7 });
    expect(r.enqueued[QUEUES.metrics]).toBe(7);
    const r2 = await scheduleTick(deps, { owner: 'a', schedules: [schedules[0]!], now, leaseTtlMs: 60_000, batchSize: 5, maxPerTick: 100 });
    expect(r2.enqueued[QUEUES.metrics]).toBe(5);
  });
});
