/** Minimal cookie handling for the auth routes (no framework dependency). */

export function parseCookies(header: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof header !== 'string' || header.length > 8_192) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    // First occurrence wins (the most specific path is sent first by browsers).
    if (name && !out.has(name)) out.set(name, value);
  }
  return out;
}

export interface CookieOptions {
  maxAgeSeconds: number;
  secure: boolean;
}

/** HttpOnly, SameSite=Lax, Path=/, no Domain (host-only, as the __Host- prefix requires). */
export function serializeCookie(name: string, value: string, o: CookieOptions): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name) || !/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('cookie name/value must be token characters');
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(o.maxAgeSeconds))}${o.secure ? '; Secure' : ''}`;
}
