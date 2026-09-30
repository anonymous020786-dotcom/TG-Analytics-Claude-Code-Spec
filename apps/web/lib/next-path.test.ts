import { describe, expect, it } from 'vitest';
import { safeNext } from './next-path';

describe('safeNext (open-redirect protection)', () => {
  it('keeps same-site paths', () => {
    expect(safeNext('/account')).toBe('/account');
    expect(safeNext('/channel/telegram?days=30')).toBe('/channel/telegram?days=30');
  });

  it.each([
    ['absolute URL', 'https://evil.example/'],
    ['protocol-relative', '//evil.example/'],
    ['backslash trick', '/\\evil.example'],
    ['scheme', 'javascript:alert(1)'],
    ['relative path', 'account'],
    ['control character', '/a\nb'],
    ['tab', '/a\tb'],
    ['empty', ''],
    ['too long', `/${'a'.repeat(600)}`],
    ['not a string', 42],
  ])('falls back for %s', (_label, raw) => {
    expect(safeNext(raw)).toBe('/account');
  });
});
