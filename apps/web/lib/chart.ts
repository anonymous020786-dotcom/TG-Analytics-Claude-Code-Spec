/**
 * Pure geometry for the subscriber line chart (server-rendered SVG, no client JS).
 * Days without an observation are gaps: a segment breaks when consecutive points are more
 * than GAP_DAYS apart, so the chart never implies values that were not observed.
 */

export interface ChartPoint {
  date: string; // YYYY-MM-DD (UTC)
  value: number;
}

export interface ChartBox {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

export interface Tick {
  value: number;
  y: number;
}

export interface PlacedPoint extends ChartPoint {
  x: number;
  y: number;
}

export interface ChartGeometry {
  segments: PlacedPoint[][];
  points: PlacedPoint[];
  yTicks: Tick[];
  xLabels: { date: string; x: number }[];
  plot: { x0: number; x1: number; y0: number; y1: number };
}

export const GAP_DAYS = 1.5;
const DAY = 86_400_000;

const dayMs = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** "Nice" step (1, 2, 2.5, 5 × 10^n) so axis labels are round numbers. */
export function niceStep(range: number, targetTicks: number): number {
  if (!(range > 0) || targetTicks < 1) return 1;
  const raw = range / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return Math.max(1, step * mag);
}

/** Y domain padded to nice bounds. Counts never go below zero. */
export function yDomain(values: readonly number[], targetTicks = 4): { min: number; max: number; step: number } {
  if (values.length === 0) return { min: 0, max: 1, step: 1 };
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    const pad = Math.max(1, Math.abs(lo) * 0.05);
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(hi - lo, targetTicks);
  return { min: Math.max(0, Math.floor(lo / step) * step), max: Math.ceil(hi / step) * step, step };
}

export function chartGeometry(points: readonly ChartPoint[], from: string, to: string, box: ChartBox): ChartGeometry {
  const { width, height, margin } = box;
  const plot = { x0: margin.left, x1: width - margin.right, y0: height - margin.bottom, y1: margin.top };
  const t0 = dayMs(from.slice(0, 10));
  const t1 = Math.max(dayMs(to.slice(0, 10)), t0 + DAY);
  const { min, max, step } = yDomain(points.map((p) => p.value));
  const x = (date: string) => plot.x0 + ((dayMs(date) - t0) / (t1 - t0)) * (plot.x1 - plot.x0);
  const y = (v: number) => plot.y0 - ((v - min) / (max - min || 1)) * (plot.y0 - plot.y1);

  const placed = [...points].sort((a, b) => dayMs(a.date) - dayMs(b.date)).map((p) => ({ ...p, x: x(p.date), y: y(p.value) }));
  const segments: PlacedPoint[][] = [];
  for (const p of placed) {
    const current = segments.at(-1);
    const prev = current?.at(-1);
    if (current && prev && (dayMs(p.date) - dayMs(prev.date)) / DAY <= GAP_DAYS) current.push(p);
    else segments.push([p]);
  }

  const yTicks: Tick[] = [];
  for (let v = min; v <= max + step / 2; v += step) yTicks.push({ value: v, y: y(v) });

  const span = Math.round((t1 - t0) / DAY);
  // At most 4 labels: with rounding to whole days they stay >= 2 days apart (no collisions).
  const labelCount = Math.min(4, span + 1);
  const xLabels = Array.from({ length: labelCount }, (_, i) => {
    const t = t0 + Math.round((i * span) / Math.max(1, labelCount - 1)) * DAY;
    const date = new Date(t).toISOString().slice(0, 10);
    return { date, x: x(date) };
  });

  return { segments, points: placed, yTicks, xLabels, plot };
}

export function linePath(segment: readonly PlacedPoint[]): string {
  return segment.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

export function areaPath(segment: readonly PlacedPoint[], baseY: number): string {
  if (segment.length < 2) return '';
  const first = segment[0]!;
  const last = segment.at(-1)!;
  return `${linePath(segment)} L${last.x.toFixed(1)},${baseY.toFixed(1)} L${first.x.toFixed(1)},${baseY.toFixed(1)} Z`;
}
