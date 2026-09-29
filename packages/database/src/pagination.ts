/**
 * Cursor pagination helpers. Cursors come from clients and are untrusted: they are
 * validated strictly and rejected with InvalidCursorError.
 */

/** Hard ceiling for any page (provisional until OD-005; NFR-PERF-02). */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export interface Page<T> {
  items: T[];
  /** Opaque cursor for the next page, or null when this is the last page. */
  nextCursor: string | null;
}

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid pagination cursor');
    this.name = 'InvalidCursorError';
  }
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE);
}

export function encodeCursor(value: Record<string, string>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decodes a cursor whose fields must match `shape` exactly ('uuid' or 'date'). */
export function decodeCursor<K extends string>(cursor: string, shape: Record<K, 'uuid' | 'date' | 'int'>): Record<K, string> {
  if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new InvalidCursorError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new InvalidCursorError();
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(shape) as K[];
  if (Object.keys(obj).length !== keys.length) throw new InvalidCursorError();
  for (const key of keys) {
    const v = obj[key];
    if (typeof v !== 'string') throw new InvalidCursorError();
    if (shape[key] === 'uuid' && !UUID.test(v)) throw new InvalidCursorError();
    if (shape[key] === 'date' && Number.isNaN(Date.parse(v))) throw new InvalidCursorError();
    if (shape[key] === 'int' && !/^\d{1,9}$/.test(v)) throw new InvalidCursorError();
  }
  return obj as Record<K, string>;
}

/** Given limit+1 fetched rows, returns the page and the cursor of its last item. */
export function toPage<T>(rows: T[], limit: number, cursorOf: (last: T) => Record<string, string>): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(cursorOf(last)) : null };
}
