import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchMethodology } from '../../lib/api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Methodology' };

/** Public methodology (FR-ANL-01): every displayed metric with its definition, from the API registry. */
export default async function DocsPage() {
  const result = await fetchMethodology();
  if (result.kind !== 'ok') notFound();
  return (
    <main id="main" className="wrap">
      <h1>Methodology</h1>
      <p>
        TG Analytics reads public data about public Telegram channels and groups through Telegram&apos;s official APIs. It never reads private chats. All figures are calculated by TG Analytics and are not official Telegram statistics.
      </p>

      <h2>Principles</h2>
      <ul>
        <li>Every value carries the time it was observed; the page shows how fresh it is.</li>
        <li>Missing data stays missing. A value that could not be observed is shown as unavailable, never as zero.</li>
        <li>Implausible observations are rejected, and sudden anomalies (such as a drop to zero) are flagged and left out of growth, charts and rankings, but kept in the history.</li>
        <li>Calculations are versioned. A change in a formula creates a new methodology version.</li>
      </ul>

      <h2>Metrics</h2>
      {result.data.metrics.map((m) => (
        <section key={m.key} aria-labelledby={`m-${m.key}`}>
          <h3 id={`m-${m.key}`}>{m.label}</h3>
          <dl className="defs small">
            <dt>Type</dt>
            <dd>{m.kind === 'raw' ? 'Observed value' : 'Calculated value'}</dd>
            <dt>Source</dt>
            <dd>{m.source}</dd>
            <dt>Observed at</dt>
            <dd>{m.observationTime}</dd>
            <dt>Calculation</dt>
            <dd>{m.calculation}</dd>
            {m.window ? (
              <>
                <dt>Window</dt>
                <dd>{m.window}</dd>
              </>
            ) : null}
            <dt>Missing data</dt>
            <dd>{m.missingData}</dd>
            <dt>Freshness</dt>
            <dd>{m.freshness}</dd>
            <dt>Version</dt>
            <dd>{m.methodologyVersion}</dd>
          </dl>
        </section>
      ))}

      <h2>Rankings and trending</h2>
      <p>
        Each ranking page states its metric, eligibility rules, tie-break and methodology version next to the list. <Link href="/rankings">Rankings</Link>
      </p>

      <h2>Public API</h2>
      <p className="small">
        Read-only JSON endpoints under <code>/api/v1</code>: <code>GET /channels</code> (search and browse), <code>GET /channels/:username</code>, <code>GET /channels/:id/stats</code>, <code>GET /search/suggest</code>, <code>GET /rankings</code>, <code>GET /trending</code> and <code>GET /methodology</code>. Full reference documentation is planned.
      </p>
    </main>
  );
}
