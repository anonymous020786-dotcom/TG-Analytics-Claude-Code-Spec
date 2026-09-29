import { describe, expect, it, vi } from 'vitest';
import { TelegramClientAdapter } from './adapter';
import { BotApiClient } from './bot-api';
import { TelegramError } from './errors';
import { MtprotoBackend, type MtprotoTransport } from './mtproto';
import { InMemoryRateLimiter } from './rate-limiter';

const TOKEN = '1234567890:TESTTOKENtesttokenTESTTOKENtest12345';
const noSleep = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: async () => {} };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setup(responses: (Response | Error)[], extra: Partial<ConstructorParameters<typeof TelegramClientAdapter>[0]> = {}) {
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    if (next instanceof Error) throw next;
    return next;
  });
  const limiter = new InMemoryRateLimiter({ capacity: 5, refillPerSecond: 1, now: () => 0, random: () => 0 });
  const adapter = new TelegramClientAdapter({
    botApi: new BotApiClient({ token: TOKEN, fetchImpl: fetchImpl as unknown as typeof fetch }),
    limiter,
    credentialId: 'bot-test',
    retry: noSleep,
    now: () => new Date('2026-09-29T00:00:00Z'),
    ...extra,
  });
  return { adapter, fetchImpl, limiter };
}

const channel = { id: -1001005640892, type: 'channel', title: 'Telegram News', username: 'telegram' };

async function failure(p: Promise<unknown>): Promise<TelegramError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof TelegramError) return e;
    throw e;
  }
  throw new Error('expected TelegramError');
}

describe('TelegramClientAdapter (Bot API)', () => {
  it('resolves a public entity with observation metadata', async () => {
    const { adapter, fetchImpl } = setup([jsonResponse(200, { ok: true, result: channel })]);
    const res = await adapter.resolvePublicEntity('@Telegram');

    expect(res).toMatchObject({ source: 'bot_api', observedAt: new Date('2026-09-29T00:00:00Z'), value: { telegramId: -1001005640892n, username: 'telegram' } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/getChat`);
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: '@telegram' });
    expect(init.signal).toBeDefined();
  });

  it('returns member counts as bigint', async () => {
    const { adapter } = setup([jsonResponse(200, { ok: true, result: 9_443_724 })]);
    expect((await adapter.getMemberCount('telegram')).value).toBe(9_443_724n);
  });

  it.each(['', 'ab', 'has space', 'https://t.me/x', '../etc', 'a'.repeat(40), '1startsdigit'])('rejects invalid username %j without any network call', async (input) => {
    const { adapter, fetchImpl } = setup([]);
    expect((await failure(adapter.resolvePublicEntity(input))).failureClass).toBe('invalid_input');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('classifies an unknown username without retrying', async () => {
    const { adapter, fetchImpl } = setup([jsonResponse(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' })]);
    const e = await failure(adapter.resolvePublicEntity('nonexistent_zz9'));
    expect([e.failureClass, e.code]).toEqual(['invalid_input', 'chat_not_found']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('on 429: does not retry, penalizes the credential, and blocks later calls locally', async () => {
    const { adapter, fetchImpl } = setup([jsonResponse(429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 33', parameters: { retry_after: 33 } })]);
    const first = await failure(adapter.resolvePublicEntity('telegram'));
    expect([first.failureClass, first.retryAfterMs]).toEqual(['rate_limited', 33_000]);

    const second = await failure(adapter.getMemberCount('telegram'));
    expect(second.code).toBe('local_rate_limit');
    expect(second.retryAfterMs).toBeGreaterThanOrEqual(33_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a transient timeout, then succeeds', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const { adapter, fetchImpl } = setup([timeout, jsonResponse(200, { ok: true, result: channel })]);
    expect((await adapter.resolvePublicEntity('telegram')).value.username).toBe('telegram');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after bounded retries on repeated 5xx', async () => {
    const bad = () => jsonResponse(502, { ok: false, error_code: 502, description: 'Bad Gateway' });
    const { adapter, fetchImpl } = setup([bad(), bad(), bad()]);
    expect((await failure(adapter.resolvePublicEntity('telegram'))).failureClass).toBe('transient');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('never leaks the bot token in errors', async () => {
    const err = Object.assign(new Error(`connect failed https://api.telegram.org/bot${TOKEN}/getChat`), { cause: { code: 'ENOTFOUND' } });
    const { adapter } = setup([err, err, err]);
    const e = await failure(adapter.resolvePublicEntity('telegram'));
    expect(e.failureClass).toBe('dependency_down');
    expect(JSON.stringify({ m: e.message, s: e.stack, o: e.options })).not.toContain(TOKEN.split(':')[1]);
  });

  it('rejects private chats as not_public', async () => {
    const { adapter } = setup([jsonResponse(200, { ok: true, result: { id: 5, type: 'private', first_name: 'x', username: 'someone' } })]);
    expect((await failure(adapter.resolvePublicEntity('someone'))).code).toBe('not_public');
  });

  it('refuses malformed tokens at construction', () => {
    expect(() => new BotApiClient({ token: 'not-a-token' })).toThrow(TelegramError);
  });
});

describe('TelegramClientAdapter (capability gate, MTProto)', () => {
  const transport: MtprotoTransport = {
    invoke: vi.fn(async (method: string) => {
      if (method === 'contacts.resolveUsername') return { chats: [{ _: 'channel', id: 1005640892, broadcast: true, verified: true, username: 'telegram', title: 'Telegram News' }] };
      if (method === 'messages.getHistory') return { messages: [{ _: 'message', id: 10, date: 1_767_225_600, views: 100 }, { _: 'messageService', id: 9, date: 1 }] };
      throw { code: 400, message: 'METHOD_INVALID' };
    }),
  };

  it('refuses unverified MTProto operations by default (fail closed)', async () => {
    const { adapter } = setup([], { mtproto: new MtprotoBackend(transport) });
    expect((await failure(adapter.getRecentPosts('telegram', 10))).code).toBe('capability_unverified');
    expect((await failure(adapter.getEntityFlags('telegram'))).code).toBe('capability_unverified');
    expect(transport.invoke).not.toHaveBeenCalled();
  });

  it('reports a missing MTProto backend clearly once verified', async () => {
    const { adapter } = setup([], { additionallyVerified: ['recentPosts'] });
    expect((await failure(adapter.getRecentPosts('telegram', 10))).code).toBe('mtproto_not_configured');
  });

  it('uses the MTProto backend once an operation is verified', async () => {
    const { adapter } = setup([], { mtproto: new MtprotoBackend(transport), additionallyVerified: ['recentPosts', 'entityFlags'] });
    const posts = await adapter.getRecentPosts('telegram', 500);
    expect(posts.source).toBe('mtproto');
    expect(posts.value).toHaveLength(1);
    expect(posts.value[0]?.views).toBe(100n);
    expect((await adapter.getEntityFlags('telegram')).value.isVerified).toBe(true);
    expect(vi.mocked(transport.invoke).mock.calls.find((c) => c[0] === 'messages.getHistory')?.[1]).toMatchObject({ limit: 100 });
  });

  it('classifies MTProto FLOOD_WAIT and penalizes the MTProto credential', async () => {
    const flood: MtprotoTransport = { invoke: async () => Promise.reject({ code: 420, message: 'FLOOD_WAIT_45' }) };
    const { adapter } = setup([], { mtproto: new MtprotoBackend(flood), additionallyVerified: ['recentPosts'] });
    const e = await failure(adapter.getRecentPosts('telegram', 10));
    expect([e.failureClass, e.retryAfterMs]).toEqual(['rate_limited', 45_000]);
    expect((await failure(adapter.getRecentPosts('telegram', 10))).code).toBe('local_rate_limit');
  });
});
