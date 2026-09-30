import { createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { dataCheckString, DEFAULT_MAX_AGE_SECONDS, telegramLoginHash, verifyTelegramLogin } from './telegram-login';
import { csrfToken, generateToken, hashToken, isTokenShape, verifyCsrfToken } from './tokens';

const BOT = '123456789:TEST-token-for-unit-tests-only_abcdefgh';
const now = new Date('2026-09-30T12:00:00Z');
const nowSec = Math.floor(now.getTime() / 1000);

/** Signs like Telegram does (independent implementation of the documented algorithm). */
function signed(fields: Record<string, string | number>, token = BOT): Record<string, string | number> {
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const key = createHash('sha256').update(token).digest();
  return { ...fields, hash: createHmac('sha256', key).update(check).digest('hex') };
}

const base = { id: 777000123, first_name: 'Ada', last_name: 'Lovelace', username: 'Ada_L', photo_url: 'https://t.me/i/userpic/320/x.jpg', auth_date: nowSec - 5 };

describe('verifyTelegramLogin', () => {
  it('accepts a correctly signed, fresh payload and returns the identity', () => {
    const r = verifyTelegramLogin(signed(base), BOT, now);
    expect(r).toEqual({
      ok: true,
      identity: { telegramId: 777000123n, firstName: 'Ada', lastName: 'Lovelace', username: 'ada_l', authDate: new Date((nowSec - 5) * 1000) },
    });
  });

  it('accepts minimal payloads (no last name, username or photo)', () => {
    const r = verifyTelegramLogin(signed({ id: 42, first_name: 'Bob', auth_date: nowSec }), BOT, now);
    expect(r.ok && r.identity.username).toBeNull();
  });

  it('matches the documented data-check-string format', () => {
    expect(dataCheckString({ id: '1', auth_date: '2', first_name: 'A', hash: 'x' })).toBe('auth_date=2\nfirst_name=A\nid=1');
    const s = signed({ id: 1, first_name: 'A', auth_date: 2 });
    expect(telegramLoginHash({ id: '1', first_name: 'A', auth_date: '2' }, BOT)).toBe(s.hash);
  });

  it('rejects any tampering: changed field, added field, removed field', () => {
    const good = signed(base);
    expect(verifyTelegramLogin({ ...good, id: 777000124 }, BOT, now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyTelegramLogin({ ...good, username: 'admin' }, BOT, now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyTelegramLogin({ ...good, is_admin: 'true' }, BOT, now)).toEqual({ ok: false, reason: 'bad_signature' });
    const { last_name: _drop, ...removed } = good;
    expect(verifyTelegramLogin(removed, BOT, now)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects payloads signed for another bot', () => {
    expect(verifyTelegramLogin(signed(base, '999:OTHER-bot-token'), BOT, now)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('enforces freshness and rejects future timestamps', () => {
    expect(verifyTelegramLogin(signed({ ...base, auth_date: nowSec - DEFAULT_MAX_AGE_SECONDS - 1 }), BOT, now)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyTelegramLogin(signed({ ...base, auth_date: nowSec - DEFAULT_MAX_AGE_SECONDS }), BOT, now).ok).toBe(true);
    expect(verifyTelegramLogin(signed({ ...base, auth_date: nowSec + 3600 }), BOT, now)).toEqual({ ok: false, reason: 'from_future' });
  });

  it('checks the signature before reporting expiry (no oracle for unsigned data)', () => {
    expect(verifyTelegramLogin({ ...signed(base), auth_date: 1 }, BOT, now)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it.each([
    ['not an object', 'id=1'],
    ['array', [1]],
    ['empty', {}],
    ['nested value', { ...signed(base), first_name: { a: 1 } }],
    ['non-numeric id', signed({ ...base, id: 'abc' })],
    ['negative id', signed({ ...base, id: -5 })],
    ['bad hash shape', { ...base, hash: 'zz' }],
    ['missing first name', signed({ id: 1, auth_date: nowSec })],
    ['control characters', signed({ ...base, first_name: 'A\u0000B' })],
    ['odd key', { ...signed(base), 'Bad-Key': 'x' }],
    ['too many fields', Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`f${'x'.repeat(i)}`, 'v']))],
    ['invalid username', signed({ ...base, username: 'a b' })],
  ])('rejects malformed input: %s', (_label, payload) => {
    const r = verifyTelegramLogin(payload, BOT, now);
    expect(r.ok).toBe(false);
  });
});

describe('tokens', () => {
  it('generates 256-bit base64url tokens and stores only a hash', () => {
    const { token, hash } = generateToken();
    expect(isTokenShape(token)).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hash);
    expect(generateToken().token).not.toBe(token);
  });

  it('rejects malformed token input', () => {
    for (const bad of [undefined, 42, '', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}!`]) expect(isTokenShape(bad)).toBe(false);
  });
});

describe('CSRF tokens', () => {
  // Generated per run: no secret-shaped literals in the repository.
  const secret = randomBytes(32).toString('base64url');

  it('verifies only for the same binding and secret', () => {
    const t = csrfToken(secret, 'sess:abc');
    expect(verifyCsrfToken(secret, 'sess:abc', t)).toBe(true);
    expect(verifyCsrfToken(secret, 'sess:other', t)).toBe(false);
    expect(verifyCsrfToken(`${secret}x`, 'sess:abc', t)).toBe(false);
    for (const bad of [undefined, '', 'x'.repeat(200), 1]) expect(verifyCsrfToken(secret, 'sess:abc', bad)).toBe(false);
  });
});
