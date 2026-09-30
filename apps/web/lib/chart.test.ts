import { describe, expect, it } from 'vitest';
import { areaPath, chartGeometry, linePath, niceStep, yDomain } from './chart';

const BOX = { width: 640, height: 240, margin: { top: 16, right: 72, bottom: 28, left: 48 } };

describe('niceStep / yDomain', () => {
  it('produces round steps', () => {
    expect(niceStep(1_000, 4)).toBe(250);
    expect(niceStep(9_000_000, 4)).toBe(2_500_000);
    expect(niceStep(7, 4)).toBe(2);
  });

  it('pads flat series and never goes below zero', () => {
    expect(yDomain([100, 100])).toMatchObject({ min: expect.any(Number), max: expect.any(Number) });
    const d = yDomain([100, 100]);
    expect(d.min).toBeLessThan(100);
    expect(d.max).toBeGreaterThan(100);
    expect(yDomain([0, 3]).min).toBe(0);
    expect(yDomain([]).max).toBe(1);
  });
});

describe('chartGeometry', () => {
  it('breaks the line at gaps instead of bridging missing days', () => {
    const g = chartGeometry(
      [
        { date: '2026-09-01', value: 10 },
        { date: '2026-09-02', value: 12 },
        { date: '2026-09-05', value: 15 },
        { date: '2026-09-06', value: 16 },
      ],
      '2026-09-01',
      '2026-09-07',
      BOX,
    );
    expect(g.segments.map((s) => s.map((p) => p.date))).toEqual([
      ['2026-09-01', '2026-09-02'],
      ['2026-09-05', '2026-09-06'],
    ]);
  });

  it('places points inside the plot, higher values higher', () => {
    const g = chartGeometry(
      [
        { date: '2026-09-01', value: 10 },
        { date: '2026-09-10', value: 20 },
      ],
      '2026-09-01',
      '2026-09-10',
      BOX,
    );
    const [a, b] = g.points;
    expect(a!.x).toBeCloseTo(g.plot.x0);
    expect(b!.x).toBeCloseTo(g.plot.x1);
    expect(b!.y).toBeLessThan(a!.y);
    for (const p of g.points) expect(p.y).toBeGreaterThanOrEqual(g.plot.y1 - 0.001);
    expect(g.xLabels.length).toBeGreaterThanOrEqual(2);
  });

  it('sorts unsorted input and handles a single point', () => {
    const g = chartGeometry(
      [
        { date: '2026-09-03', value: 3 },
        { date: '2026-09-01', value: 1 },
      ],
      '2026-09-01',
      '2026-09-03',
      BOX,
    );
    expect(g.points.map((p) => p.date)).toEqual(['2026-09-01', '2026-09-03']);
    const one = chartGeometry([{ date: '2026-09-01', value: 5 }], '2026-09-01', '2026-09-01', BOX);
    expect(one.segments).toHaveLength(1);
    expect(areaPath(one.segments[0]!, one.plot.y0)).toBe('');
  });

  it('builds SVG paths', () => {
    const seg = [
      { date: 'a', value: 1, x: 0, y: 10 },
      { date: 'b', value: 2, x: 5, y: 5 },
    ];
    expect(linePath(seg)).toBe('M0.0,10.0 L5.0,5.0');
    expect(areaPath(seg, 20)).toBe('M0.0,10.0 L5.0,5.0 L5.0,20.0 L0.0,20.0 Z');
  });
});

describe('x labels', () => {
  it('never places labels on adjacent days (7-day window)', () => {
    const g = chartGeometry([{ date: '2026-09-29', value: 1 }], '2026-09-23', '2026-09-30', BOX);
    const days = g.xLabels.map((l) => Date.parse(`${l.date}T00:00:00Z`) / 86_400_000);
    for (let i = 1; i < days.length; i += 1) expect(days[i]! - days[i - 1]!).toBeGreaterThanOrEqual(2);
    expect(g.xLabels.length).toBeLessThanOrEqual(4);
  });
});
