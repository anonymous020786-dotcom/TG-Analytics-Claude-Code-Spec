import Link from 'next/link';
import { breadcrumbList, type Crumb, jsonLd } from '../lib/seo';

/**
 * Structured data. The only raw-HTML sink in the app: the payload is produced by `jsonLd`,
 * which escapes <, >, & and U+2028/2029, so untrusted Telegram text cannot leave the script.
 */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}

/** Visible breadcrumbs plus the matching BreadcrumbList. */
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <>
      <nav aria-label="Breadcrumb" className="small muted">
        <ol className="crumbs">
          {crumbs.map((c, i) => (
            <li key={c.path}>{i === crumbs.length - 1 ? <span aria-current="page">{c.name}</span> : <Link href={c.path}>{c.name}</Link>}</li>
          ))}
        </ol>
      </nav>
      <JsonLd data={breadcrumbList(crumbs)} />
    </>
  );
}
