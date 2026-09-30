import { DataTable, EmptyState } from '@tga/ui';
import { areaPath, chartGeometry, linePath } from '../lib/chart';
import { formatCompact, formatCount, formatDate, formatShortDate } from '../lib/format';

interface Props {
  points: { date: string; value: string; observedAt: string }[];
  from: string;
  to: string;
  /** Accessible name and caption; the heading names the single series (no legend). */
  title: string;
  /** Show the data table toggle (statistics page). */
  table?: boolean;
  excludedAnomalies?: number;
}

const BOX = { width: 640, height: 240, margin: { top: 28, right: 72, bottom: 32, left: 64 } };

/**
 * Subscriber history, server-rendered SVG (no client JS). Hover shows a crosshair and value
 * per day (CSS + native tooltip); gaps are drawn as gaps; a table view carries every value.
 */
export function MemberChart({ points, from, to, title, table = false, excludedAnomalies = 0 }: Props) {
  if (points.length === 0) {
    return (
      <EmptyState title="No subscriber history in this period yet.">
        <p>Values appear after the next collection.</p>
      </EmptyState>
    );
  }

  const numeric = points.map((p) => ({ date: p.date, value: Number(p.value) }));
  const g = chartGeometry(numeric, from, to, BOX);
  const first = points[0]!;
  const last = points.at(-1)!;
  const lastPlaced = g.points.at(-1)!;
  const bandWidth = Math.max(4, (g.plot.x1 - g.plot.x0) / Math.max(1, g.points.length));
  const summary = `${title}: ${formatCount(first.value)} on ${formatDate(first.date)}, ${formatCount(last.value)} on ${formatDate(last.date)}; ${points.length} days with data.`;

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${BOX.width} ${BOX.height}`} role="img" aria-label={summary}>
        <g className="grid" aria-hidden="true">
          {g.yTicks.map((t) => (
            <line key={t.value} x1={g.plot.x0} x2={g.plot.x1} y1={t.y} y2={t.y} />
          ))}
        </g>
        <g className="axis" aria-hidden="true">
          {g.yTicks.map((t) => (
            <text key={t.value} x={g.plot.x0 - 8} y={t.y + 4} textAnchor="end">
              {formatCompact(t.value)}
            </text>
          ))}
          {g.xLabels.map((l, i) => (
            <text key={l.date} x={l.x} y={BOX.height - 8} textAnchor={i === 0 ? 'start' : i === g.xLabels.length - 1 ? 'end' : 'middle'}>
              {formatShortDate(l.date)}
            </text>
          ))}
        </g>
        {g.segments.map((s) => (
          <path key={`a${s[0]!.date}`} className="area" d={areaPath(s, g.plot.y0)} aria-hidden="true" />
        ))}
        {g.segments.map((s) => (
          <path key={`l${s[0]!.date}`} className="line" d={s.length > 1 ? linePath(s) : ''} aria-hidden="true" />
        ))}
        {g.segments
          .filter((s) => s.length === 1)
          .map((s) => (
            <circle key={`d${s[0]!.date}`} className="dot" cx={s[0]!.x} cy={s[0]!.y} r={4} aria-hidden="true" />
          ))}
        <circle className="dot" cx={lastPlaced.x} cy={lastPlaced.y} r={4} aria-hidden="true" />
        <text className="end-label" x={lastPlaced.x + 8} y={lastPlaced.y + 4} aria-hidden="true">
          {formatCompact(lastPlaced.value)}
        </text>
        <g className="hit" aria-hidden="true">
          {g.points.map((p, i) => (
            <g key={p.date}>
              <title>{`${formatDate(p.date)}: ${formatCount(points[i]!.value)} subscribers`}</title>
              <line className="cross" x1={p.x} x2={p.x} y1={g.plot.y1} y2={g.plot.y0} />
              <circle className="mark" cx={p.x} cy={p.y} r={5} />
              <text className="readout" x={p.x > BOX.width / 2 ? p.x - 8 : p.x + 8} y={g.plot.y1 - 8} textAnchor={p.x > BOX.width / 2 ? 'end' : 'start'}>
                {`${formatShortDate(p.date)} · ${formatCount(points[i]!.value)}`}
              </text>
              <rect x={p.x - bandWidth / 2} y={g.plot.y1} width={bandWidth} height={g.plot.y0 - g.plot.y1} />
            </g>
          ))}
        </g>
      </svg>
      <figcaption className="small muted">
        Last valid count per day (UTC). Days without an observation are left blank.
        {excludedAnomalies > 0 ? ` ${excludedAnomalies} anomalous observation${excludedAnomalies === 1 ? ' was' : 's were'} excluded.` : ''}
      </figcaption>
      {table ? (
        <details>
          <summary>Show data table</summary>
          <DataTable
            caption={title}
            rows={[...points].reverse()}
            rowKey={(p) => p.date}
            columns={[
              { key: 'day', header: 'Day (UTC)', cell: (p) => formatDate(p.date) },
              { key: 'value', header: 'Subscribers', cell: (p) => formatCount(p.value), numeric: true },
            ]}
          />
        </details>
      ) : null}
    </figure>
  );
}
