import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { JobRepository, MAX_RATE_LIMIT_RESCHEDULES } from '../src';
import { resetTables, testDb } from './helpers';

const db = testDb();
const jobs = new JobRepository(db);

beforeEach(() => resetTables(db));
afterAll(() => db.$disconnect());

let seq = 0;
const enqueue = (overrides: Partial<Parameters<JobRepository['enqueue']>[0]> = {}) =>
  jobs.enqueue({ queue: 'channel.metrics', type: 'initial', idempotencyKey: `k${(seq += 1)}`, payloadVersion: 1, payload: { channelId: 'x' }, maxAttempts: 3, ...overrides });

describe('dispatch claims', () => {
  it('claims only due, queued jobs of the requested queues, once', async () => {
    const due = (await enqueue()).job;
    await enqueue({ scheduledAt: new Date(Date.now() + 3_600_000) });
    await enqueue({ queue: 'search.index' });

    const claimed = await jobs.claimForDispatch(['channel.metrics'], 10, 60_000);
    expect(claimed).toEqual([{ id: due.id, queue: 'channel.metrics' }]);
    expect(await jobs.claimForDispatch(['channel.metrics'], 10, 60_000)).toEqual([]);
  });

  it('never hands the same job to two concurrent dispatchers', async () => {
    for (let i = 0; i < 20; i += 1) await enqueue();
    const [a, b] = await Promise.all([jobs.claimForDispatch(['channel.metrics'], 15, 60_000), jobs.claimForDispatch(['channel.metrics'], 15, 60_000)]);
    const ids = [...a, ...b].map((c) => c.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it('re-claims stale dispatches that never started (lost push)', async () => {
    const { job } = await enqueue();
    await jobs.claimForDispatch(['channel.metrics'], 10, 60_000);
    expect(await jobs.claimForDispatch(['channel.metrics'], 10, 60_000)).toEqual([]);
    expect((await jobs.claimForDispatch(['channel.metrics'], 10, 0)).map((c) => c.id)).toEqual([job.id]);
  });

  it('honours priority, then schedule order', async () => {
    const low = (await enqueue({ priority: 0 })).job;
    const high = (await enqueue({ priority: 10 })).job;
    expect((await jobs.claimForDispatch(['channel.metrics'], 1, 60_000))[0]?.id).toBe(high.id);
    expect((await jobs.claimForDispatch(['channel.metrics'], 1, 60_000))[0]?.id).toBe(low.id);
  });
});

describe('attempt lifecycle', () => {
  it('runs a job exactly once even if delivered twice', async () => {
    const { job } = await enqueue();
    const [first, second] = await Promise.all([jobs.startAttempt(job.id), jobs.startAttempt(job.id)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const started = (first ?? second)!;
    expect(started).toMatchObject({ execution: 1, job: { id: job.id, attempt: 1, payloadVersion: 1, payload: { channelId: 'x' } } });

    await jobs.completeAttempt(job.id, started.execution);
    expect((await jobs.findById(job.id))?.status).toBe('succeeded');
    expect(await jobs.startAttempt(job.id)).toBeNull();
    expect(await db.jobAttempt.findFirst({ where: { jobId: job.id } })).toMatchObject({ outcome: 'succeeded' });
  });

  it('records failures with class and truncated message', async () => {
    const { job } = await enqueue();
    const s = (await jobs.startAttempt(job.id))!;
    await jobs.failAttempt(job.id, s.execution, 'invalid_input', 'x'.repeat(5_000));

    expect(await jobs.findById(job.id)).toMatchObject({ status: 'failed', lastErrorClass: 'invalid_input' });
    const attempt = await db.jobAttempt.findFirstOrThrow({ where: { jobId: job.id } });
    expect([attempt.outcome, attempt.errorClass, attempt.errorMessage?.length]).toEqual(['failed', 'invalid_input', 2_000]);
  });

  it('reschedules rate-limited jobs later without consuming an attempt', async () => {
    const { job } = await enqueue({ maxAttempts: 1 });
    const s = (await jobs.startAttempt(job.id))!;
    const before = Date.now();
    expect(await jobs.rescheduleAfterRateLimit(job.id, s.execution, 30_000, 'Too Many Requests')).toBe('rescheduled');

    const after = (await jobs.findById(job.id))!;
    expect(after).toMatchObject({ status: 'queued', attempt: 0, dispatchedAt: null, lastErrorClass: 'rate_limited' });
    expect(after.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 30_000);
    expect(await jobs.claimForDispatch(['channel.metrics'], 10, 0)).toEqual([]);

    // Once due again it runs as a new execution, still within maxAttempts = 1.
    await db.job.update({ where: { id: job.id }, data: { scheduledAt: new Date(Date.now() - 1_000) } });
    expect((await jobs.startAttempt(job.id))?.execution).toBe(2);
  });

  it('fails the job once the reschedule cap is reached', async () => {
    const { job } = await enqueue();
    for (let i = 0; i < MAX_RATE_LIMIT_RESCHEDULES; i += 1) {
      await db.job.update({ where: { id: job.id }, data: { scheduledAt: new Date(Date.now() - 1_000) } });
      const s = (await jobs.startAttempt(job.id))!;
      expect(await jobs.rescheduleAfterRateLimit(job.id, s.execution, 1, 'slow')).toBe('rescheduled');
    }
    await db.job.update({ where: { id: job.id }, data: { scheduledAt: new Date(Date.now() - 1_000) } });
    const s = (await jobs.startAttempt(job.id))!;
    expect(await jobs.rescheduleAfterRateLimit(job.id, s.execution, 1, 'slow')).toBe('exhausted');
    expect(await jobs.findById(job.id)).toMatchObject({ status: 'failed', lastErrorClass: 'rate_limited' });
  });

  it('does not start a job whose attempts are exhausted', async () => {
    const { job } = await enqueue({ maxAttempts: 1 });
    await db.job.update({ where: { id: job.id }, data: { attempt: 1 } });
    expect(await jobs.startAttempt(job.id)).toBeNull();
  });
});
