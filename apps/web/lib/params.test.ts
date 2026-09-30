import { describe, expect, it } from 'vitest';
import { listQueryString, parseListQuery, parseWindow } from './params';

describe('parseListQuery', () => {
  it('keeps valid fields and drops invalid or repeated ones', () => {
    expect(parseListQuery({ q: '  news ', type: 'group', minMembers: '100', maxMembers: '-1', sort: 'members', cursor: 'abc_-1' })).toEqual({
      q: 'news',
      type: 'group',
      minMembers: '100',
      sort: 'members',
      cursor: 'abc_-1',
    });
    expect(parseListQuery({ q: ['a', 'b'], type: 'bot', sort: 'random', cursor: "x';--" })).toEqual({});
  });

  it('bounds the query length it forwards', () => {
    expect(parseListQuery({ q: 'x'.repeat(1000) }).q).toHaveLength(256);
  });

  it('round-trips into an encoded query string and replaces the cursor', () => {
    const q = parseListQuery({ q: 'a&b=c', type: 'channel', cursor: 'old' });
    expect(listQueryString(q, 'new')).toBe('?q=a%26b%3Dc&type=channel&cursor=new');
    expect(listQueryString(q, null)).toBe('?q=a%26b%3Dc&type=channel');
    expect(listQueryString({})).toBe('');
  });
});

describe('parseWindow', () => {
  it('accepts only offered windows', () => {
    expect(parseWindow({ days: '90' })).toBe(90);
    expect(parseWindow({ days: '14' })).toBe(30);
    expect(parseWindow({ days: ['7', '30'] })).toBe(30);
    expect(parseWindow({})).toBe(30);
  });
});
