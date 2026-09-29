import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { JobRepository, LeaseRepository, MAX_RATE_LIMIT_RESCHEDULES } from '../src';
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
    expect(await jobs.recordFailure(job.id, s.execution, 'invalid_input', 'x'.repeat(5_000), 0)).toBe('dead');

    expect(await jobs.findById(job.id)).toMatchObject({ status: 'dead', lastErrorClass: 'invalid_input' });
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
    expect(await jobs.findById(job.id)).toMatchObject({ status: 'dead', lastErrorClass: 'rate_limited' });
    expect(await db.deadLetterJob.count({ where: { jobId: job.id } })).toBe(1);
  });

  it('does not start a job whose attempts are exhausted', async () => {
    const { job } = await enqueue({ maxAttempts: 1 });
    await db.job.update({ where: { id: job.id }, data: { attempt: 1 } });
    expect(await jobs.startAttempt(job.id)).toBeNull();
  });
});

const due = (id: string) => db.job.update({ where: { id }, data: { scheduledAt: new Date(Date.now() - 1_000) } });

describe('retry policy, DLQ and re-drive (PHASE-09)', () => {
  it('requeues retryable failures with backoff while attempts remain, then dead-letters', async () => {
    const { job } = await enqueue({ maxAttempts: 2 });
    let s = (await jobs.startAttempt(job.id))!;
    const before = Date.now();
    expect(await jobs.recordFailure(job.id, s.execution, 'transient', 'timeout', 60_000)).toBe('retry_scheduled');
    const queued = (await jobs.findById(job.id))!;
    expect(queued).toMatchObject({ status: 'queued', attempt: 1, dispatchedAt: null, leaseExpiresAt: null });
    expect(queued.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);

    await due(job.id);
    s = (await jobs.startAttempt(job.id))!;
    expect(await jobs.recordFailure(job.id, s.execution, 'transient', 'timeout again', 60_000)).toBe('dead');
    expect(await db.deadLetterJob.findUniqueOrThrow({ where: { jobId: job.id } })).toMatchObject({ errorClass: 'transient', redrivenAt: null });
    expect((await jobs.attemptHistory(job.id)).map((a) => [a.attempt, a.outcome, a.errorClass])).toEqual([
      [1, 'failed', 'transient'],
      [2, 'failed', 'transient'],
    ]);
  });

  it('ends permanent failures as failed (no DLQ) and authorization failures as dead', async () => {
    const a = (await enqueue()).job;
    expect(await jobs.recordFailure(a.id, (await jobs.startAttempt(a.id))!.execution, 'permanent', 'gone', 0)).toBe('failed');
    expect(await db.deadLetterJob.count({ where: { jobId: a.id } })).toBe(0);
    const b = (await enqueue()).job;
    expect(await jobs.recordFailure(b.id, (await jobs.startAttempt(b.id))!.execution, 'authorization', 'revoked', 0)).toBe('dead');
  });

  it('re-drives a dead job once, resets its attempt budget, and audits it', async () => {
    const { job } = await enqueue({ maxAttempts: 1 });
    await jobs.recordFailure(job.id, (await jobs.startAttempt(job.id))!.execution, 'unknown', 'boom', 0);
    expect((await jobs.listDeadLetters()).items.map((d) => d.jobId)).toEqual([job.id]);

    const actor = { actorType: 'user' as const, actorId: 'admin-1' };
    expect(await jobs.redrive(job.id, actor, 'req-1')).toBe('redriven');
    expect(await jobs.redrive(job.id, actor)).toBe('not_dead');
    expect(await jobs.findById(job.id)).toMatchObject({ status: 'queued', attempt: 0 });
    expect(await db.deadLetterJob.findUniqueOrThrow({ where: { jobId: job.id } })).toMatchObject({ redrivenBy: 'admin-1' });
    expect((await jobs.listDeadLetters()).items).toHaveLength(0);
    expect(await db.auditLog.findFirstOrThrow({ where: { targetId: job.id } })).toMatchObject({ action: 'job.redrive', actorId: 'admin-1', requestId: 'req-1' });
    expect((await jobs.startAttempt(job.id))?.execution).toBe(2);
  });

  it('refuses to re-drive jobs that are not dead', async () => {
    const { job } = await enqueue();
    expect(await jobs.redrive(job.id, { actorType: 'user', actorId: 'x' })).toBe('not_dead');
  });

  it('dead-letters again after a failed re-drive (re-opens the DLQ record)', async () => {
    const { job } = await enqueue({ maxAttempts: 1 });
    await jobs.recordFailure(job.id, (await jobs.startAttempt(job.id))!.execution, 'unknown', 'first', 0);
    await jobs.redrive(job.id, { actorType: 'system', actorId: 'ops' });
    await jobs.recordFailure(job.id, (await jobs.startAttempt(job.id))!.execution, 'unknown', 'second', 0);
    expect(await db.deadLetterJob.findUniqueOrThrow({ where: { jobId: job.id } })).toMatchObject({ errorMessage: 'second', redrivenAt: null });
  });
});

describe('leases and the reaper (PHASE-09)', () => {
  it('heartbeats extend the lease of a running job only', async () => {
    const { job } = await enqueue();
    const s = (await jobs.startAttempt(job.id, 5_000))!;
    const first = (await jobs.findById(job.id))!.leaseExpiresAt!;
    expect(await jobs.heartbeat(job.id, 60_000)).toBe(true);
    expect((await jobs.findById(job.id))!.leaseExpiresAt!.getTime()).toBeGreaterThan(first.getTime());
    await jobs.completeAttempt(job.id, s.execution);
    expect(await jobs.heartbeat(job.id)).toBe(false);
    expect((await jobs.findById(job.id))!.leaseExpiresAt).toBeNull();
  });

  it('recovers jobs whose worker died: retry while attempts remain, else DLQ', async () => {
    const a = (await enqueue({ maxAttempts: 3 })).job;
    const b = (await enqueue({ maxAttempts: 1 })).job;
    const c = (await enqueue()).job;
    await jobs.startAttempt(a.id);
    await jobs.startAttempt(b.id);
    await jobs.startAttempt(c.id); // healthy lease
    await db.job.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { leaseExpiresAt: new Date(Date.now() - 1_000) } });

    const recovered = await jobs.recoverExpiredLeases(10, 30_000);
    expect(Object.fromEntries(recovered.map((r) => [r.jobId, r.outcome]))).toEqual({ [a.id]: 'retry_scheduled', [b.id]: 'dead' });
    expect((await jobs.findById(c.id))!.status).toBe('running');
    expect((await jobs.attemptHistory(a.id))[0]).toMatchObject({ outcome: 'failed', errorClass: 'transient' });
    expect(await jobs.recoverExpiredLeases(10, 30_000)).toEqual([]);
  });

  it('concurrent reapers never recover the same job twice', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const { job } = await enqueue();
      await jobs.startAttempt(job.id);
      ids.push(job.id);
    }
    await db.job.updateMany({ where: { id: { in: ids } }, data: { leaseExpiresAt: new Date(Date.now() - 1_000) } });
    const [x, y] = await Promise.all([jobs.recoverExpiredLeases(10, 1_000), jobs.recoverExpiredLeases(10, 1_000)]);
    expect([...x, ...y].map((r) => r.jobId).sort()).toEqual([...ids].sort());
  });
});

describe('LeaseRepository', () => {
  const leases = new LeaseRepository(db);

  it('grants a free lease, blocks other owners, allows renewal by the holder', async () => {
    expect(await leases.acquire('scheduler:tick', 'a', 60_000)).toBe(true);
    expect(await leases.acquire('scheduler:tick', 'b', 60_000)).toBe(false);
    expect(await leases.acquire('scheduler:tick', 'a', 60_000)).toBe(true);
  });

  it('lets another owner take an expired lease, and only the holder can release', async () => {
    await leases.acquire('k', 'a', 60_000);
    await db.lease.update({ where: { key: 'k' }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect(await leases.acquire('k', 'b', 60_000)).toBe(true);
    await leases.release('k', 'a');
    expect(await leases.acquire('k', 'a', 60_000)).toBe(false);
    await leases.release('k', 'b');
    expect(await leases.acquire('k', 'a', 60_000)).toBe(true);
  });

  it('grants exactly one of many concurrent acquirers', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => leases.acquire('race', 'o' + i, 60_000)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
