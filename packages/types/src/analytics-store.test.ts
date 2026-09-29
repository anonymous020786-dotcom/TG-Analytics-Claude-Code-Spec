import { describe, expect, it } from 'vitest';
import {
  isValidMetricKey,
  MAX_SNAPSHOT_BATCH,
  type MetricSnapshot,
  SnapshotValidationError,
  validateSeriesQuery,
  validateSnapshotBatch,
} from './analytics-store';

const ID = '01920000-0000-7000-8000-000000000001';
const now = new Date('2026-06-01T00:00:00Z');
const ok: MetricSnapshot = { entityId: ID, metric: 'members', value: 10n, observedAt: new Date('2026-05-31T00:00:00Z'), source: 'mtproto' };

function issuesOf(batch: MetricSnapshot[]): string[] {
  try {
    validateSnapshotBatch(batch, now);
  } catch (e) {
    if (e instanceof SnapshotValidationError) return e.issues;
    throw e;
  }
  return [];
}

describe('isValidMetricKey', () => {
  it.each(['members', 'views', 'reactions.total', 'post_views'])('accepts %s', (k) => expect(isValidMetricKey(k)).toBe(true));
  it.each(['', 'Members', '1views', 'views.', 'a'.repeat(65), "views'; drop"])('rejects %s', (k) => expect(isValidMetricKey(k)).toBe(false));
});

describe('validateSnapshotBatch', () => {
  it('accepts a valid batch, including zero (a real observed zero)', () => {
    expect(issuesOf([ok, { ...ok, value: 0n }])).toEqual([]);
  });

  it('reports every problem at once', () => {
    const issues = issuesOf([
      { ...ok, entityId: 'x' },
      { ...ok, value: -1n },
      { ...ok, observedAt: new Date('invalid') },
      { ...ok, observedAt: new Date('2026-06-02T00:00:00Z') },
      { ...ok, source: 'scraper' as never },
      { ...ok, jobId: 'nope' },
    ]);
    expect(issues).toHaveLength(6);
  });

  it('rejects non-bigint values (no silent float coercion)', () => {
    expect(issuesOf([{ ...ok, value: 10 as unknown as bigint }])).toHaveLength(1);
  });

  it('bounds batch size', () => {
    const batch = Array.from({ length: MAX_SNAPSHOT_BATCH + 1 }, () => ok);
    expect(issuesOf(batch)[0]).toMatch(/exceeds MAX_SNAPSHOT_BATCH/);
  });
});

describe('validateSeriesQuery', () => {
  it('requires a non-empty, ordered range', () => {
    const q = { entityId: ID, metric: 'members', from: new Date('2026-01-02'), to: new Date('2026-01-01') };
    expect(() => validateSeriesQuery(q)).toThrow(SnapshotValidationError);
    expect(() => validateSeriesQuery({ ...q, to: q.from })).toThrow(SnapshotValidationError);
    expect(() => validateSeriesQuery({ ...q, to: new Date('2026-01-03') })).not.toThrow();
  });
});
