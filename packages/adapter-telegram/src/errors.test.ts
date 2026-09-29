import { describe, expect, it } from 'vitest';
import { classifyBotApiError, classifyMtprotoError, classifyNetworkError, sanitize } from './errors';

describe('classifyBotApiError', () => {
  it('maps 429 to rate_limited with retry_after in ms', () => {
    const e = classifyBotApiError(429, { error_code: 429, description: 'Too Many Requests: retry after 33', parameters: { retry_after: 33 } });
    expect(e.failureClass).toBe('rate_limited');
    expect(e.retryAfterMs).toBe(33_000);
  });

  it('falls back to a positive wait when retry_after is missing', () => {
    expect(classifyBotApiError(429, { error_code: 429 }).retryAfterMs).toBeGreaterThan(0);
  });

  it.each([
    [400, 'Bad Request: chat not found', 'invalid_input', 'chat_not_found'],
    [400, 'Bad Request: something else', 'invalid_input', 'bad_request'],
    [401, 'Unauthorized', 'authorization', 'unauthorized'],
    [404, 'Not Found', 'authorization', 'unauthorized'],
    [403, 'Forbidden: bot was kicked', 'authorization', 'forbidden'],
    [502, 'Bad Gateway', 'transient', 'server_error'],
    [418, 'teapot', 'unknown', 'unexpected'],
  ])('maps %i "%s" to %s', (status, description, cls, code) => {
    const e = classifyBotApiError(status, { error_code: status, description });
    expect(e.failureClass).toBe(cls);
    expect(e.code).toBe(code);
  });

  it('classifies a non-JSON body by HTTP status', () => {
    expect(classifyBotApiError(503, undefined).failureClass).toBe('transient');
  });
});

describe('classifyMtprotoError', () => {
  it.each([
    ['FLOOD_WAIT_30', 30_000],
    ['FLOOD_PREMIUM_WAIT_5', 5_000],
    ['SLOWMODE_WAIT_12', 12_000],
  ])('parses %s into a wait of %i ms', (message, ms) => {
    const e = classifyMtprotoError({ code: 420, message });
    expect(e.failureClass).toBe('rate_limited');
    expect(e.retryAfterMs).toBe(ms);
  });

  it.each([
    [400, 'CHANNEL_PRIVATE', 'permanent'],
    [400, 'CHANNEL_PUBLIC_GROUP_NA', 'permanent'],
    [400, 'USERNAME_NOT_OCCUPIED', 'invalid_input'],
    [401, 'AUTH_KEY_UNREGISTERED', 'authorization'],
    [403, 'CHAT_WRITE_FORBIDDEN', 'permanent'],
    [406, 'CHANNEL_TOO_LARGE', 'invalid_input'],
    [500, 'INTERNAL', 'transient'],
  ])('maps %i %s to %s', (code, message, cls) => {
    expect(classifyMtprotoError({ code, message }).failureClass).toBe(cls);
  });
});

describe('classifyNetworkError', () => {
  it('treats timeouts and resets as transient, DNS/refused as dependency_down', () => {
    expect(classifyNetworkError(Object.assign(new Error('t'), { name: 'TimeoutError' }), 'bot_api').failureClass).toBe('transient');
    expect(classifyNetworkError(Object.assign(new Error('x'), { cause: { code: 'ECONNRESET' } }), 'bot_api').failureClass).toBe('transient');
    expect(classifyNetworkError(Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } }), 'bot_api').failureClass).toBe('dependency_down');
    expect(classifyNetworkError(new Error('?'), 'bot_api').failureClass).toBe('unknown');
  });
});

describe('sanitize', () => {
  it('removes anything shaped like a bot token or bot URL', () => {
    const token = '1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';
    expect(sanitize(`failed https://api.telegram.org/bot${token}/getChat`)).not.toContain(token);
    expect(sanitize(`token ${token} leaked`)).not.toContain(token);
  });
});
