import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Alert, Button, CursorPager, DataTable, EmptyState, Field, FreshnessBadge, LinkTabs, Skeleton, StatCard } from './components';

const html = (node: ReactNode) => renderToStaticMarkup(<>{node}</>);
const A = ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);

describe('Alert', () => {
  it('conveys tone with an icon and a text label, not color alone', () => {
    const out = html(<Alert tone="warning">Data is stale</Alert>);
    expect(out).toContain('data-tone="warning"');
    expect(out).toContain('aria-hidden="true">!</span>');
    expect(out).toContain('<span class="ui-visually-hidden">Warning: </span>');
  });

  it('announces only when live: errors assertively, others politely', () => {
    expect(html(<Alert tone="error" live>x</Alert>)).toContain('role="alert"');
    expect(html(<Alert tone="info" live>x</Alert>)).toContain('role="status"');
    expect(html(<Alert tone="error">x</Alert>)).not.toContain('role=');
  });
});

describe('StatCard', () => {
  it('shows an explicit unavailable text instead of a value (never 0)', () => {
    const out = html(<StatCard label="Last 7 days" value={null} unavailable="Not enough history yet" />);
    expect(out).toContain('Not enough history yet');
    expect(out).not.toContain('ui-stat-value');
  });
});

describe('Field', () => {
  it('wires hint and error to the control', () => {
    const out = html(
      <Field label="Min subscribers" hint="Whole number" error="Must be a number">
        <input id="min" name="min" />
      </Field>,
    );
    expect(out).toContain('<label for="min">Min subscribers</label>');
    expect(out).toContain('aria-describedby="min-hint min-error"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('id="min-error"');
  });

  it('requires an id on the control', () => {
    expect(() => html(<Field label="x">{<input />}</Field>)).toThrow(/needs an id/);
  });
});

describe('Skeleton / Button / FreshnessBadge', () => {
  it('announces loading once and hides the shape', () => {
    const out = html(<Skeleton label="Loading chart" />);
    expect(out).toContain('role="status"');
    expect(out).toContain('Loading chart…');
    expect(out).toContain('class="ui-skeleton" aria-hidden="true"');
  });

  it('exposes busy/disabled state and defaults to type=button', () => {
    const out = html(<Button busy>Save</Button>);
    expect(out).toContain('type="button"');
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('aria-disabled="true"');
  });

  it('maps freshness verdicts to shape + text, unknown to neutral', () => {
    expect(html(<FreshnessBadge verdict="failing" />)).toMatch(/data-tone="bad".*■.*Collection failing/);
    expect(html(<FreshnessBadge verdict="whatever" />)).toContain('Unknown');
  });
});

describe('navigation', () => {
  it('marks the current tab and labels the nav', () => {
    const out = html(
      <LinkTabs
        label="Time range"
        Link={A}
        items={[
          { href: '?d=7', label: '7 days', current: true },
          { href: '?d=30', label: '30 days', current: false },
        ]}
      />,
    );
    expect(out).toContain('aria-label="Time range"');
    expect(out).toContain('<a href="?d=7" aria-current="page">7 days</a>');
    expect(out).toContain('<a href="?d=30">30 days</a>');
  });

  it('renders nothing when there is only one page', () => {
    expect(html(<CursorPager Link={A} />)).toBe('');
    expect(html(<CursorPager Link={A} nextHref="/x?cursor=a" />)).toContain('rel="next"');
  });
});

describe('DataTable / EmptyState', () => {
  it('is a labelled, keyboard-scrollable region with caption and column headers', () => {
    const out = html(
      <DataTable
        caption="Subscribers by day"
        rows={[{ d: '2026-09-20', v: '9,441,662' }]}
        rowKey={(r) => r.d}
        columns={[
          { key: 'd', header: 'Day', cell: (r) => r.d },
          { key: 'v', header: 'Subscribers', cell: (r) => r.v, numeric: true },
        ]}
      />,
    );
    expect(out).toContain('role="region" aria-label="Subscribers by day" tabindex="0"');
    expect(out).toContain('<caption>Subscribers by day</caption>');
    expect(out).toContain('<th scope="col" data-numeric="true">Subscribers</th>');
  });

  it('renders untrusted text escaped', () => {
    expect(html(<EmptyState title={'<img src=x onerror=alert(1)>'} />)).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
