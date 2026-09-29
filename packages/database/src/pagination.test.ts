import { describe, expect, it } from 'vitest';
import { clampLimit, decodeCursor, DEFAULT_PAGE_SIZE, encodeCursor, InvalidCursorError, MAX_PAGE_SIZE, toPage } from './pagination';

const ID = '01920000-0000-7000-8000-000000000001';

describe('clampLimit', () => {
  it('defaults, floors and caps the page size', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit(Number.NaN)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(10.9)).toBe(10);
    expect(clampLimit(1_000_000)).toBe(MAX_PAGE_SIZE);
  });
});

describe('decodeCursor', () => {
  it('round-trips a valid cursor', () => {
    const c = encodeCursor({ postedAt: '2026-01-01T00:00:00.000Z', id: ID });
    expect(decodeCursor(c, { postedAt: 'date', id: 'uuid' })).toEqual({ postedAt: '2026-01-01T00:00:00.000Z', id: ID });
  });

  it.each([
    ['not base64url', 'a$b'],
    ['not JSON', Buffer.from('nope').toString('base64url')],
    ['array', encodeCursor({} as Record<string, string>).replace(/.*/, Buffer.from('[]').toString('base64url'))],
    ['missing field', encodeCursor({ id: ID })],
    ['extra field', encodeCursor({ id: ID, postedAt: '2026-01-01T00:00:00Z', x: '1' })],
    ['bad uuid (injection attempt)', encodeCursor({ id: "1' OR '1'='1", postedAt: '2026-01-01T00:00:00Z' })],
    ['bad date', encodeCursor({ id: ID, postedAt: 'yesterday' })],
    ['oversized', 'a'.repeat(600)],
  ])('rejects %s', (_label, cursor) => {
    expect(() => decodeCursor(cursor, { postedAt: 'date', id: 'uuid' })).toThrow(InvalidCursorError);
  });
});

describe('toPage', () => {
  it('returns a cursor only when more rows exist', () => {
    expect(toPage([{ id: 'a' }, { id: 'b' }], 2, (r) => r).nextCursor).toBeNull();
    const page = toPage([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2, (r) => r);
    expect(page.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(page.nextCursor).toBe(encodeCursor({ id: 'b' }));
  });
});
