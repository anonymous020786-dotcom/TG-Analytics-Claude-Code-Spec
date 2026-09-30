import { describe, expect, it } from 'vitest';
import { MAX_QUERY_LENGTH, normalizeSearchQuery, normalizeSearchText } from './search';

describe('normalizeSearchQuery', () => {
  it('lowercases, applies NFKC and collapses whitespace', () => {
    expect(normalizeSearchQuery('  Ｔｅｌｅｇｒａｍ   News ')).toBe('telegram news');
  });

  it('strips @ and t.me link prefixes', () => {
    expect(normalizeSearchQuery('@Durov')).toBe('durov');
    expect(normalizeSearchQuery('https://t.me/durov')).toBe('durov');
    expect(normalizeSearchQuery('t.me/durov')).toBe('durov');
  });

  it('removes control and format characters', () => {
    expect(normalizeSearchQuery('te\u0000le​gram')).toBe('te le gram');
  });

  it('keeps non-Latin scripts', () => {
    expect(normalizeSearchQuery('Новости')).toBe('новости');
  });

  it('rejects too short, too long and non-string input', () => {
    expect(normalizeSearchQuery('a')).toBeNull();
    expect(normalizeSearchQuery('   @ ')).toBeNull();
    expect(normalizeSearchQuery('x'.repeat(MAX_QUERY_LENGTH + 1))).toBeNull();
    expect(normalizeSearchQuery(123 as unknown as string)).toBeNull();
  });

  it('passes SQL/LIKE metacharacters through as data (escaped by the index)', () => {
    expect(normalizeSearchQuery("x'; drop table channels;--")).toBe("x'; drop table channels;--");
    expect(normalizeSearchQuery('50%_off')).toBe('50%_off');
  });
});

describe('normalizeSearchText', () => {
  it('is idempotent', () => {
    const once = normalizeSearchText('Ｍixed  CASE\ttext');
    expect(normalizeSearchText(once)).toBe(once);
  });
});
