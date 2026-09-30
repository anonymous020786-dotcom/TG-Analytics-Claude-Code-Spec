import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Sign in with Telegram (Telegram Login Widget, core.telegram.org/widgets/login; D-021).
 *
 * The widget returns the user's fields plus `hash` = hex(HMAC-SHA256(data_check_string,
 * SHA256(bot_token))), where data_check_string is every received field except `hash`, sorted by
 * key, as `key=value` lines joined with "\n". Only a party holding the bot token can produce a
 * valid hash, so a verified payload proves Telegram authenticated this user for our bot.
 * `auth_date` bounds replay of an intercepted payload.
 */

export interface TelegramIdentity {
  /** Stable Telegram user id (fits in 52 bits; kept as bigint for storage). */
  telegramId: bigint;
  firstName: string;
  lastName: string | null;
  username: string | null;
  authDate: Date;
}

export type TelegramLoginResult = { ok: true; identity: TelegramIdentity } | { ok: false; reason: TelegramLoginRejection };

export type TelegramLoginRejection = 'malformed' | 'bad_signature' | 'expired' | 'from_future';

/** Default acceptance window for `auth_date` (the widget posts immediately after sign-in). */
export const DEFAULT_MAX_AGE_SECONDS = 600;
const CLOCK_SKEW_SECONDS = 60;
const MAX_FIELDS = 12;
const MAX_VALUE_LENGTH = 512;

/** Builds the data-check string from all fields except `hash` (exported for tests/tools). */
export function dataCheckString(fields: Record<string, string>): string {
  return Object.keys(fields)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
}

export function telegramLoginHash(fields: Record<string, string>, botToken: string): string {
  const secret = createHash('sha256').update(botToken, 'utf8').digest();
  return createHmac('sha256', secret).update(dataCheckString(fields), 'utf8').digest('hex');
}

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/** Accepts only flat string/number fields with bounded sizes; values are compared as strings. */
function toFields(payload: unknown): Record<string, string> | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_FIELDS) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (!/^[a-z_]{1,32}$/.test(k)) return null;
    if (typeof v === 'number' && Number.isSafeInteger(v)) out[k] = String(v);
    else if (typeof v === 'string' && v.length <= MAX_VALUE_LENGTH && !hasControlChars(v)) out[k] = v;
    else return null;
  }
  return out;
}

export function verifyTelegramLogin(payload: unknown, botToken: string, now: Date = new Date(), maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS): TelegramLoginResult {
  const fields = toFields(payload);
  if (!fields) return { ok: false, reason: 'malformed' };
  const { id, first_name: firstName, auth_date: authDate, hash } = fields;
  if (!id || !/^[1-9]\d{0,15}$/.test(id)) return { ok: false, reason: 'malformed' };
  if (!authDate || !/^\d{1,12}$/.test(authDate)) return { ok: false, reason: 'malformed' };
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: 'malformed' };
  if (!firstName || firstName.length > 256) return { ok: false, reason: 'malformed' };
  if (fields.username !== undefined && !/^[A-Za-z0-9_]{1,64}$/.test(fields.username)) return { ok: false, reason: 'malformed' };

  // Signature first: nothing else about an unsigned payload is trusted or reported.
  const expected = Buffer.from(telegramLoginHash(fields, botToken), 'hex');
  const got = Buffer.from(hash, 'hex');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return { ok: false, reason: 'bad_signature' };

  const nowSec = Math.floor(now.getTime() / 1000);
  const at = Number(authDate);
  if (at > nowSec + CLOCK_SKEW_SECONDS) return { ok: false, reason: 'from_future' };
  if (nowSec - at > maxAgeSeconds) return { ok: false, reason: 'expired' };

  return {
    ok: true,
    identity: {
      telegramId: BigInt(id),
      firstName: firstName.normalize('NFC'),
      lastName: fields.last_name ? fields.last_name.normalize('NFC') : null,
      username: fields.username ? fields.username.toLowerCase() : null,
      authDate: new Date(at * 1000),
    },
  };
}
