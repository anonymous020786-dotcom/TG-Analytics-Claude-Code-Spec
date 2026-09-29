import { createLogger } from '@tga/logging';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { type JobLedger, type LedgerJob, parsePayload, PayloadError, type QueueTransport } from './contracts';
import { ConsumerRuntime, Dispatcher, handleShutdown, safeMessage } from './runtime';

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
    failAttempt: vi.fn(async (_id: string, _execution: number, _cls: string, _msg: string) => {}),
    rescheduleAfterRateLimit: vi.fn(async () => 'rescheduled' as const),
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
    expect(await rt.process('j1')).toBe('failed');
    expect(handler).not.toHaveBeenCalled();
    expect(ledger.failAttempt).toHaveBeenCalledWith('j1', 1, 'invalid_input', expect.stringContaining('PayloadError'));
  });

  it('reschedules rate-limited jobs using the provider wait', async () => {
    const ledger = fakeLedger();
    const err = Object.assign(new Error('Too Many Requests'), { failureClass: 'rate_limited', retryAfterMs: 33_000 });
    const { rt } = make(ledger, vi.fn(async () => Promise.reject(err)));
    expect(await rt.process('j1')).toBe('rescheduled');
    expect(ledger.rescheduleAfterRateLimit).toHaveBeenCalledWith('j1', 1, 33_000, expect.any(String));
    expect(ledger.failAttempt).not.toHaveBeenCalled();
  });

  it('records classified failures, and unknown errors as "unknown"', async () => {
    const ledger = fakeLedger();
    const classified = Object.assign(new Error('no'), { failureClass: 'authorization' });
    await make(ledger, vi.fn(async () => Promise.reject(classified))).rt.process('j1');
    await make(ledger, vi.fn(async () => Promise.reject(new TypeError('bug')))).rt.process('j1');
    expect(ledger.failAttempt.mock.calls.map((c) => c[2])).toEqual(['authorization', 'unknown']);
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
