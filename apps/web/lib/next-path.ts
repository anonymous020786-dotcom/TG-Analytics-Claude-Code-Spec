/**
 * Post-login destination. Only same-site absolute paths are accepted, so `?next=` can never
 * redirect a user to another site (open redirect): no scheme, no protocol-relative `//host`,
 * no backslashes (browsers treat `/\host` like `//host`), no control characters.
 */
export function safeNext(raw: unknown, fallback = '/account'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || ch === '\\') return fallback;
  }
  return raw;
}
