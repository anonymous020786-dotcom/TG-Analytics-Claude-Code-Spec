import { createLogger } from '@tga/logging';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { type JobLedger, type LedgerJob, parsePayload, PayloadError, type QueueTransport } from './contracts';
import { computeBackoffMs, ConsumerRuntime, Dispatcher, handleShutdown, Reaper, safeMessage } from './runtime';

const logger = createLogger({ name: 'test', level: 'silent', destination: new Writable({ write: (_c, _e, cb) => cb() }) });
const CHANNEL = '01920000-0000-7000-8000-000000000001';

function job(overrides: Partial<LedgerJob> = {}): LedgerJob {
  return { id: 'j1', queue: 'channel.metrics', type: 'initial', payload: { channelId: CHANNEL }, payloadVersion: 1, entityId: CHANNEL, traceId: null, attempt: 1, maxAttempts: 3, ...overrides };
}

function fakeLedger(started: { job: LedgerJob; execution: number } | null = { job: job(), execution: 1 }) {
  return {
    claimForDispatch: vi.fn(async () => [
      { id: 'a', queue: 'channel.metrics' },
      { id: 'b', queue: 'channel.metrics' },
    ]),
    startAttempt: vi.fn(async () => started),
    completeAttempt: vi.fn(async () => {}),
    heartbeat: vi.fn(async (_id: string, _leaseMs: number) => true),
    recordFailure: vi.fn(async (_id: string, _execution: number, _cls: string, _msg: string, _delay: number) => 'retry_scheduled' as 'retry_scheduled' | 'failed' | 'dead'),
    rescheduleAfterRateLimit: vi.fn(async () => 'rescheduled' as const),
    recoverExpiredLeases: vi.fn(async () => [{ jobId: 'x', outcome: 'retry_scheduled' as const }]),
  } satisfies JobLedger;
}

const fakeTransport = (push: QueueTransport['push'] = vi.fn(async () => {})): QueueTransport => ({ push, consume: vi.fn(() => ({ close: async () => {} })), close: async () => {} });

describe('parsePayload', () => {
  it('accepts valid versioned payloads', () => {
    expect(parsePayload('channel.metrics', 1, { channelId: CHANNEL })).toEqual({ channelId: CHANNEL });
  });

  it.each([
    ['unknown version', 'channel.metrics', 2, { channelId: CHANNEL }],
    ['queue without schema', 'exports.generate', 1, {}],
    ['bad uuid', 'channel.metrics', 1, { channelId: 'x' }],
    ['extra keys (poisoning)', 'channel.metrics', 1, { channelId: CHANNEL, sql: 'drop' }],
    ['oversized discovery input', 'channel.discovery', 1, { input: 'x'.repeat(300) }],
  ])('rejects %s as invalid_input', (_l, queue, version, payload) => {
    expect(() => parsePayload(queue, version, payload)).toThrow(PayloadError);
  });
});

describe('Dispatcher', () => {
  it('pushes every claimed job and survives individual push failures', async () => {
    const push = vi.fn(async (_q: string, id: string) => {
      if (id === 'a') throw new Error('redis down');
    });
    const ledger = fakeLedger();
    const d = new Dispatcher({ ledger, transport: fakeTransport(push), queues: ['channel.metrics'], logger });
    expect(await d.tick()).toBe(1);
    expect(push).toHaveBeenCalledTimes(2);
    expect(ledger.claimForDispatch).toHaveBeenCalledWith(['channel.metrics'], 100, 300_000);
  });
});

describe('ConsumerRuntime.process', () => {
  const make = (ledger: JobLedger, handler = vi.fn(async () => {})) =>
    ({ rt: new ConsumerRuntime({ ledger, transport: fakeTransport(), queue: 'channel.metrics', handler, logger }), handler });

  it('runs the handler with the validated payload and completes the job', async () => {
    const ledger = fakeLedger();
    const { rt, handler } = make(ledger);
    expect(await rt.process('j1')).toBe('succeeded');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ payload: { channelId: CHANNEL }, execution: 1 }));
    expect(ledger.completeAttempt).toHaveBeenCalledWith('j1', 1);
  });

  it('skips jobs that are not runnable (duplicate delivery)', async () => {
    const ledger = fakeLedger(null);
    const { rt, handler } = make(ledger);
    expect(await rt.process('j1')).toBe('skipped');
    expect(handler).not.toHaveBeenCalled();
  });

  it('fails poisoned payloads as invalid_input without running the handler', async () => {
    const ledger = fakeLedger({ job: job({ payload: { channelId: 'nope' } }), execution: 1 });
    const { rt, handler } = make(ledger);
    ledger.recordFailure.mockResolvedValueOnce('dead');
    expect(await rt.process('j1')).toBe('dead');
    expect(handler).not.toHaveBeenCalled();
    expect(ledger.recordFailure).toHaveBeenCalledWith('j1', 1, 'invalid_input', expect.stringContaining('PayloadError'), expect.any(Number));
  });

  it('reschedules rate-limited jobs using the provider wait', async () => {
    const ledger = fakeLedger();
    const err = Object.assign(new Error('Too Many Requests'), { failureClass: 'rate_limited', retryAfterMs: 33_000 });
    const { rt } = make(ledger, vi.fn(async () => Promise.reject(err)));
    expect(await rt.process('j1')).toBe('rescheduled');
    expect(ledger.rescheduleAfterRateLimit).toHaveBeenCalledWith('j1', 1, 33_000, expect.any(String));
    expect(ledger.recordFailure).not.toHaveBeenCalled();
  });

  it('records classified failures, and unknown errors as "unknown"', async () => {
    const ledger = fakeLedger();
    const classified = Object.assign(new Error('no'), { failureClass: 'authorization' });
    await make(ledger, vi.fn(async () => Promise.reject(classified))).rt.process('j1');
    await make(ledger, vi.fn(async () => Promise.reject(new TypeError('bug')))).rt.process('j1');
    expect(ledger.recordFailure.mock.calls.map((c) => c[2])).toEqual(['authorization', 'unknown']);
  });
});

describe('safeMessage', () => {
  it('redacts URL credentials and bot tokens and bounds length', () => {
    const m = safeMessage(new Error('connect redis://:s3cret@host:6379 and postgresql://tga:pw@db/x token 1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'));
    expect(m).not.toContain('s3cret');
    expect(m).not.toContain(':pw@');
    expect(m).not.toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    expect(safeMessage(new Error('x'.repeat(5_000))).length).toBe(2_000);
  });
});

describe('handleShutdown', () => {
  it('on SIGTERM: stops components (letting in-flight work finish), releases resources, exits 0', async () => {
    const order: string[] = [];
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const before = process.listeners('SIGTERM').length;
    handleShutdown(
      [{ stop: async () => { await new Promise((r) => setTimeout(r, 50)); order.push('in-flight finished'); } }],
      async () => { order.push('released'); },
      logger,
    );
    process.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(order).toEqual(['in-flight finished', 'released']);
    expect(process.listeners('SIGTERM').length).toBe(before);
    process.removeAllListeners('SIGINT');
    exit.mockRestore();
  });
});

describe('reliability (PHASE-09)', () => {
  it('computes bounded exponential backoff with equal jitter', () => {
    const p = { baseMs: 1_000, maxMs: 10_000 };
    expect([1, 2, 3, 4, 5, 50].map((a) => computeBackoffMs(a, p, () => 0))).toEqual([500, 1_000, 2_000, 4_000, 5_000, 5_000]);
    expect([1, 2, 3, 4, 5, 50].map((a) => computeBackoffMs(a, p, () => 0.999999))).toEqual([999, 1_999, 3_999, 7_999, 9_999, 9_999]);
  });

  it('passes the backoff delay for the current attempt to the ledger', async () => {
    const ledger = fakeLedger({ job: job({ attempt: 2 }), execution: 3 });
    const rt = new ConsumerRuntime({ ledger, transport: fakeTransport(), queue: 'channel.metrics', logger, backoff: { baseMs: 1_000, maxMs: 60_000 }, handler: vi.fn(async () => Promise.reject(Object.assign(new Error('t'), { failureClass: 'transient' }))) });
    expect(await rt.process('j1')).toBe('retry_scheduled');
    const delay = ledger.recordFailure.mock.calls[0]?.[4] ?? -1;
    expect(delay).toBeGreaterThanOrEqual(1_000);
    expect(delay).toBeLessThan(2_000);
  });

  it('heartbeats while a long handler runs, and stops afterwards', async () => {
    vi.useFakeTimers();
    try {
      const ledger = fakeLedger();
      let release!: () => void;
      const handler = vi.fn(() => new Promise<void>((r) => (release = r)));
      const rt = new ConsumerRuntime({ ledger, transport: fakeTransport(), queue: 'channel.metrics', logger, leaseMs: 30_000, handler });
      const done = rt.process('j1');
      await vi.advanceTimersByTimeAsync(35_000);
      expect(ledger.heartbeat.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(ledger.heartbeat).toHaveBeenCalledWith('j1', 30_000);
      release();
      await done;
      const after = ledger.heartbeat.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(ledger.heartbeat.mock.calls.length).toBe(after);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports rate-limit reschedule exhaustion as dead', async () => {
    const ledger = fakeLedger();
    ledger.rescheduleAfterRateLimit.mockResolvedValueOnce('exhausted' as never);
    const err = Object.assign(new Error('slow'), { failureClass: 'rate_limited', retryAfterMs: 1_000 });
    const rt = new ConsumerRuntime({ ledger, transport: fakeTransport(), queue: 'channel.metrics', logger, handler: vi.fn(async () => Promise.reject(err)) });
    expect(await rt.process('j1')).toBe('dead');
  });

  it('Reaper recovers expired leases through the ledger', async () => {
    const ledger = fakeLedger();
    expect(await new Reaper({ ledger, logger, batchSize: 50 }).tick()).toBe(1);
    expect(ledger.recoverExpiredLeases).toHaveBeenCalledWith(50, expect.any(Number));
  });
});
