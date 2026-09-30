const countFmt = new Intl.NumberFormat('en');
const compactFmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDateFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Exact count from a decimal string (API counts are strings: bigint-safe). */
export function formatCount(value: string): string {
  return /^-?\d+$/.test(value) ? countFmt.format(BigInt(value)) : value;
}

/** Compact axis label (1.2M, 950K). */
export function formatCompact(value: number): string {
  return compactFmt.format(value);
}

export function formatSignedCount(value: string): string {
  if (!/^-?\d+$/.test(value)) return value;
  const n = BigInt(value);
  return `${n > 0n ? '+' : ''}${countFmt.format(n)}`;
}

export function formatPercent(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function formatAge(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 3_600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}

/** ISO timestamp or YYYY-MM-DD → "Sep 20, 2026" (UTC, so server and client agree). */
export function formatDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : shortDateFmt.format(d);
}
