import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, REDACTED } from './index';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  return { lines, stream };
}

describe('createLogger', () => {
  it('emits structured JSON with service, level label and ISO time', () => {
    const { lines, stream } = capture();
    createLogger({ name: 'test', destination: stream }).info({ jobId: 'j1' }, 'hello');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ service: 'test', level: 'info', msg: 'hello', jobId: 'j1' });
    expect(typeof lines[0]?.time).toBe('string');
  });

  it('redacts secrets at top level and one level deep', () => {
    const { lines, stream } = capture();
    createLogger({ name: 'test', destination: stream }).info({
      password: 'p',
      credentials: { apiHash: 'h', botToken: 't' },
      user: { id: 'u1', token: 'x' },
    });

    expect(lines[0]).toMatchObject({
      password: REDACTED,
      credentials: { apiHash: REDACTED, botToken: REDACTED },
      user: { id: 'u1', token: REDACTED },
    });
  });

  it('redacts authorization, cookie and API key headers', () => {
    const { lines, stream } = capture();
    createLogger({ name: 'test', destination: stream }).info({
      req: { headers: { authorization: 'Bearer abc', cookie: 'sid=1', 'x-api-key': 'k', accept: '*/*' } },
    });

    expect(lines[0]?.req).toEqual({
      headers: { authorization: REDACTED, cookie: REDACTED, 'x-api-key': REDACTED, accept: '*/*' },
    });
  });

  it('respects the configured level', () => {
    const { lines, stream } = capture();
    const logger = createLogger({ name: 'test', level: 'warn', destination: stream });
    logger.info('dropped');
    logger.warn('kept');

    expect(lines.map((l) => l.msg)).toEqual(['kept']);
  });
});
