import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque secrets (session tokens, email verification and reset tokens): 256 random bits,
 * base64url. Only the SHA-256 hash is stored, so a database leak does not expose usable
 * tokens (ASVS V3.2, V2.5).
 */
export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Well-formed token string (43 base64url chars for 32 bytes); anything else is rejected early. */
export function isTokenShape(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * CSRF token bound to the caller's session (or pre-session nonce): HMAC-SHA256 with a server
 * secret. Stateless, rotates with the session, and cannot be forged without the secret.
 */
export function csrfToken(secret: string, binding: string): string {
  return createHmac('sha256', secret).update(`csrf:${binding}`, 'utf8').digest('base64url');
}

export function verifyCsrfToken(secret: string, binding: string, presented: unknown): boolean {
  if (typeof presented !== 'string' || presented.length === 0 || presented.length > 128) return false;
  const expected = Buffer.from(csrfToken(secret, binding));
  const got = Buffer.from(presented);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
