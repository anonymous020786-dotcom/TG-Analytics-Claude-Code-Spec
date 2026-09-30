import { describe, expect, it } from 'vitest';
import { formatAge, formatCount, formatDate, formatPercent, formatSignedCount } from './format';

describe('format', () => {
  it('formats bigint-safe counts', () => {
    expect(formatCount('9441662')).toBe('9,441,662');
    expect(formatCount('92233720368547758')).toBe('92,233,720,368,547,758');
    expect(formatCount('n/a')).toBe('n/a');
  });

  it('signs growth, including zero and negatives', () => {
    expect(formatSignedCount('1200')).toBe('+1,200');
    expect(formatSignedCount('-5')).toBe('-5');
    expect(formatSignedCount('0')).toBe('0');
  });

  it('never invents a percentage', () => {
    expect(formatPercent(null)).toBeNull();
    expect(formatPercent(Number.NaN)).toBeNull();
    expect(formatPercent(1.234)).toBe('+1.23%');
    expect(formatPercent(-0.5)).toBe('-0.50%');
  });

  it('describes ages and dates in UTC', () => {
    expect(formatAge(null)).toBe('never');
    expect(formatAge(30)).toBe('1 min ago');
    expect(formatAge(7_200)).toBe('2 h ago');
    expect(formatAge(172_800)).toBe('2 d ago');
    expect(formatDate('2026-09-20')).toBe('Sep 20, 2026');
    expect(formatDate('2026-09-20T23:30:00Z')).toBe('Sep 20, 2026');
  });
});
