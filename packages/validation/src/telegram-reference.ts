/**
 * Discovery input normalization (DISCOVERY.md: "public URL/username -> normalize -> validate").
 * Pure string processing: no network access, so hostile input can never trigger a request
 * to an arbitrary host (THREAT-MODEL T05).
 */

export type ReferenceRejection =
  | 'empty'
  | 'too_long'
  | 'not_telegram_host'
  | 'invite_link'
  | 'private_link'
  | 'unsupported_link'
  | 'invalid_username';

export type NormalizeResult = { ok: true; username: string } | { ok: false; reason: ReferenceRejection };

/** Telegram public usernames: letter first, then letters/digits/underscores; 4–32 chars (incl. short collectible names). */
export const PUBLIC_USERNAME = /^[a-z][a-z0-9_]{3,31}$/;

const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me', 'telegram.dog']);
/** First path segments that are Telegram features, not usernames. */
const RESERVED_SEGMENTS = new Set(['s', 'share', 'addstickers', 'addemoji', 'addtheme', 'proxy', 'socks', 'login', 'iv', 'setlanguage', 'boost', 'addlist', 'bg', 'invoice', 'contact', 'm']);
const MAX_INPUT = 256;

function checkUsername(candidate: string): NormalizeResult {
  const u = candidate.toLowerCase();
  return PUBLIC_USERNAME.test(u) ? { ok: true, username: u } : { ok: false, reason: 'invalid_username' };
}

/**
 * Accepts: `name`, `@name`, `t.me/name`, `https://t.me/name`, `telegram.me/name`,
 * `t.me/s/name` (public preview), `t.me/name/123` (post link), `tg://resolve?domain=name`.
 * Rejects invite links (`t.me/+…`, `t.me/joinchat/…`), private links (`t.me/c/…`),
 * non-Telegram hosts and malformed usernames.
 */
export function normalizeTelegramReference(input: string): NormalizeResult {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: 'empty' };
  if (raw.length > MAX_INPUT) return { ok: false, reason: 'too_long' };

  if (/^tg:/i.test(raw)) {
    const m = /^tg:\/\/resolve\?(?:.*&)?domain=([^&#]+)/i.exec(raw);
    return m?.[1] ? checkUsername(m[1]) : { ok: false, reason: 'unsupported_link' };
  }

  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^[^/\s]+\.[a-z]{2,}(\/|$)/i.test(raw);
  if (!looksLikeUrl) return checkUsername(raw.replace(/^@/, ''));

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, reason: 'unsupported_link' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'not_telegram_host' };
  if (url.username || url.password || url.port) return { ok: false, reason: 'not_telegram_host' };
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!TELEGRAM_HOSTS.has(host)) return { ok: false, reason: 'not_telegram_host' };

  const segments = url.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  const first = segments[0];
  if (!first) return { ok: false, reason: 'unsupported_link' };
  if (first.startsWith('+') || first.toLowerCase() === 'joinchat') return { ok: false, reason: 'invite_link' };
  if (first.toLowerCase() === 'c') return { ok: false, reason: 'private_link' };
  if (first.toLowerCase() === 's') return segments[1] ? checkUsername(segments[1]) : { ok: false, reason: 'unsupported_link' };
  if (RESERVED_SEGMENTS.has(first.toLowerCase())) return { ok: false, reason: 'unsupported_link' };
  // t.me/name or t.me/name/123 (post link): the username is the first segment.
  if (segments.length > 2) return { ok: false, reason: 'unsupported_link' };
  if (segments[1] !== undefined && !/^\d+$/.test(segments[1])) return { ok: false, reason: 'unsupported_link' };
  return checkUsername(first);
}
