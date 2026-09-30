import type { ButtonHTMLAttributes, ComponentType, CSSProperties, ReactElement, ReactNode } from 'react';
import { Children, cloneElement, isValidElement } from 'react';

/**
 * Server-compatible primitives (no hooks, no client state). Accessibility is part of each
 * component's contract so pages cannot forget it: tone is never color alone, fields wire
 * hints/errors to inputs, scrollable tables are focusable labelled regions.
 */

export type LinkComponent = ComponentType<{ href: string; className?: string; children?: ReactNode; 'aria-current'?: 'page'; rel?: string }>;

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="ui-visually-hidden">{children}</span>;
}

export function SkipLink({ href = '#main', children = 'Skip to content' }: { href?: string; children?: ReactNode }) {
  return (
    <a className="ui-skip" href={href}>
      {children}
    </a>
  );
}

export function Button({ variant = 'secondary', busy = false, children, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary'; busy?: boolean }) {
  return (
    <button {...rest} type={type} className={cx('ui-button', rest.className)} data-variant={variant} aria-busy={busy || undefined} aria-disabled={rest.disabled || busy || undefined}>
      {children}
    </button>
  );
}

export function Card({ title, children, as: Tag = 'div' }: { title?: ReactNode; children: ReactNode; as?: 'div' | 'section' | 'article' }) {
  return (
    <Tag className="ui-card">
      {title ? <h3>{title}</h3> : null}
      {children}
    </Tag>
  );
}

/** A labelled metric. `value` null renders the explicit unavailable text, never 0. */
export function StatCard({ label, value, unavailable = 'Not available', detail }: { label: string; value: ReactNode | null; unavailable?: string; detail?: ReactNode }) {
  return (
    <Card title={label}>
      {value === null ? <p className="ui-muted">{unavailable}</p> : <p className="ui-stat-value">{value}</p>}
      {detail ? <p className="ui-small ui-muted">{detail}</p> : null}
    </Card>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="ui-grid">{children}</div>;
}

export type Tone = 'info' | 'success' | 'warning' | 'error';
const TONE: Record<Tone, { icon: string; label: string }> = {
  info: { icon: 'i', label: 'Note' },
  success: { icon: '✓', label: 'Success' },
  warning: { icon: '!', label: 'Warning' },
  error: { icon: '×', label: 'Error' },
};

/**
 * Message box. Tone is conveyed by an icon and a visually hidden label as well as color.
 * `live` makes it announce: errors assertively (role=alert), others politely (role=status).
 */
export function Alert({ tone = 'info', title, children, live = false }: { tone?: Tone; title?: ReactNode; children?: ReactNode; live?: boolean }) {
  const t = TONE[tone];
  const role = live ? (tone === 'error' ? 'alert' : 'status') : undefined;
  return (
    <div className="ui-alert" data-tone={tone} role={role}>
      <span className="ui-alert-icon" aria-hidden="true">
        {t.icon}
      </span>
      <div>
        <VisuallyHidden>{`${t.label}: `}</VisuallyHidden>
        {title ? (
          <p>
            <strong>{title}</strong>
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** No results / nothing collected yet: says what is missing and, optionally, what to do next. */
export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <Alert tone="info" title={title}>
      {children}
      {action ? <p>{action}</p> : null}
    </Alert>
  );
}

/** Loading placeholder: announced once as a polite status; the shape itself is hidden. */
export function Skeleton({ label = 'Loading', style }: { label?: string; style?: CSSProperties }) {
  return (
    <div role="status" aria-live="polite">
      <span className="ui-skeleton" style={style} aria-hidden="true" />
      <VisuallyHidden>{label}…</VisuallyHidden>
    </div>
  );
}

export type StatusTone = 'good' | 'warning' | 'bad' | 'neutral';
const STATUS_ICON: Record<StatusTone, string> = { good: '●', warning: '▲', bad: '■', neutral: '○' };

/** Status with shape + text (never color alone). */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className="ui-badge" data-tone={tone}>
      <span aria-hidden="true">{STATUS_ICON[tone]}</span>
      {children}
    </span>
  );
}

/** Data-freshness verdicts from the API (assessChannelQuality) mapped to a status badge. */
export const FRESHNESS: Record<string, { tone: StatusTone; label: string }> = {
  ok: { tone: 'good', label: 'Up to date' },
  stale: { tone: 'warning', label: 'Out of date' },
  failing: { tone: 'bad', label: 'Collection failing' },
  never_collected: { tone: 'neutral', label: 'Not collected yet' },
  unavailable: { tone: 'neutral', label: 'Not available' },
};

export function FreshnessBadge({ verdict }: { verdict: string }) {
  const f = FRESHNESS[verdict] ?? { tone: 'neutral' as const, label: 'Unknown' };
  return <StatusBadge tone={f.tone}>{f.label}</StatusBadge>;
}

/**
 * Form field: label, optional hint and error, wired to the single child control with
 * aria-describedby / aria-invalid. The child must carry an `id`.
 */
export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }> }) {
  const child = Children.only(children);
  const id = isValidElement(child) ? child.props.id : undefined;
  if (!id) throw new Error('Field: the control needs an id');
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(child, { ...(describedBy ? { 'aria-describedby': describedBy } : {}), ...(error ? { 'aria-invalid': true } : {}) })}
      {hint ? (
        <span id={hintId} className="ui-hint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="ui-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export interface TabItem {
  href: string;
  label: ReactNode;
  current: boolean;
}

/** Navigation tabs rendered as links (URLs stay shareable; no client state). */
export function LinkTabs({ label, items, Link }: { label: string; items: TabItem[]; Link: LinkComponent }) {
  return (
    <nav aria-label={label}>
      <ul className="ui-tabs">
        {items.map((t) => (
          <li key={t.href}>
            <Link href={t.href} {...(t.current ? { 'aria-current': 'page' as const } : {})}>
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Forward-only cursor pagination (keyset APIs cannot jump back arbitrarily). */
export function CursorPager({ firstHref, nextHref, Link, firstLabel = 'Back to first page' }: { firstHref?: string; nextHref?: string; Link: LinkComponent; firstLabel?: string }) {
  if (!firstHref && !nextHref) return null;
  return (
    <nav className="ui-pager" aria-label="Pagination">
      {firstHref ? <Link href={firstHref}>{firstLabel}</Link> : null}
      {nextHref ? (
        <Link href={nextHref} rel="next">
          Next page
        </Link>
      ) : null}
    </nav>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  numeric?: boolean;
}

/**
 * Table with a caption, column headers and a keyboard-scrollable labelled region, so wide
 * tables scroll inside themselves on small screens (WCAG 1.4.10, 2.1.1).
 */
export function DataTable<T>({ caption, columns, rows, rowKey }: { caption: string; columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string }) {
  return (
    // tabIndex: a scrollable region must be reachable by keyboard to scroll it.
    <div className="ui-table-region" role="region" aria-label={caption} tabIndex={0}>
      <table className="ui-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" data-numeric={c.numeric || undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.key} data-numeric={c.numeric || undefined}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DefinitionList({ items }: { items: { term: ReactNode; description: ReactNode; key: string }[] }) {
  return (
    <dl className="ui-defs">
      {items.map((i) => (
        <div key={i.key} style={{ display: 'contents' }}>
          <dt>{i.term}</dt>
          <dd>{i.description}</dd>
        </div>
      ))}
    </dl>
  );
}
