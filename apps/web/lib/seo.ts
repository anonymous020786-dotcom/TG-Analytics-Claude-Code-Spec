import type { Metadata } from 'next';

/**
 * SEO helpers (PHASE-14, SEO.md). Pure functions: canonical URLs, robots decisions, safe
 * JSON-LD, descriptions from real data only (never fabricated statistics).
 */

const DEFAULT_SITE = 'http://127.0.0.1:3000';
export const SITE_NAME = 'TG Analytics';

/** Public origin from PUBLIC_SITE_URL: http(s), origin only (no path, query or credentials). */
export function siteOrigin(raw: string | undefined = process.env.PUBLIC_SITE_URL): string {
  const url = new URL(raw || DEFAULT_SITE);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('PUBLIC_SITE_URL must be http(s)');
  if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) throw new Error('PUBLIC_SITE_URL must be an origin only');
  return url.origin;
}

export function absoluteUrl(path: string, origin = siteOrigin()): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('path must be site-relative');
  return `${origin}${path}`;
}

/**
 * Robots for a page. `indexable` already combines the master switch with the page's own rule;
 * non-indexable pages stay followable so crawlers can still reach indexable ones.
 */
export function robots(indexable: boolean): NonNullable<Metadata['robots']> {
  return indexable ? { index: true, follow: true } : { index: false, follow: true };
}

export interface PageSeo {
  title: string;
  description: string;
  /** Site-relative canonical path (no query unless it identifies distinct content). */
  path: string;
  indexable: boolean;
}

export function pageMetadata({ title, description, path, indexable }: PageSeo): Metadata {
  const url = absoluteUrl(path);
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: robots(indexable),
    openGraph: { title, description, url, siteName: SITE_NAME, type: 'website', locale: 'en' },
    twitter: { card: 'summary', title, description },
  };
}

/** Meta description: collapsed whitespace, at most `max` characters, cut at a word boundary. */
export function clampDescription(text: string, max = 160): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

const countFmt = new Intl.NumberFormat('en');

/** Channel description from observed data only; no count when none was collected. */
export function channelDescription(c: { title: string; username: string; type: string; description: string | null; members: { value: string } | null }): string {
  const kind = c.type === 'group' ? 'public Telegram group' : 'public Telegram channel';
  const count = c.members && /^\d+$/.test(c.members.value) ? `${countFmt.format(BigInt(c.members.value))} subscribers. ` : '';
  const about = c.description ? ` ${c.description}` : '';
  return clampDescription(`${c.title} (@${c.username}), ${kind}. ${count}Subscriber history, growth and data freshness.${about}`);
}

/**
 * JSON for a <script type="application/ld+json"> element. Telegram text is untrusted
 * (THREAT-MODEL T03): `<`, `>`, `&` and U+2028/2029 are escaped so no value can close the
 * script element or break parsing.
 */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export interface Crumb {
  name: string;
  path: string;
}

export function breadcrumbList(crumbs: readonly Crumb[], origin = siteOrigin()) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: absoluteUrl(c.path, origin) })),
  };
}

export function websiteJsonLd(origin = siteOrigin()) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: `${origin}/`,
    potentialAction: { '@type': 'SearchAction', target: `${origin}/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
  };
}

/** Channel page: a WebPage about the Telegram entity, with the observation time as dateModified. */
export function channelJsonLd(c: { title: string; username: string; description: string | null; members: { observedAt: string } | null }, path: string, origin = siteOrigin()) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${c.title} (@${c.username})`,
    url: absoluteUrl(path, origin),
    ...(c.members ? { dateModified: c.members.observedAt } : {}),
    about: { '@type': 'Thing', name: c.title, identifier: `@${c.username}`, sameAs: `https://t.me/${c.username}`, ...(c.description ? { description: c.description } : {}) },
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${origin}/` },
  };
}

/** Sitemap XML (single file, ≤ 50,000 URLs by protocol). Values are XML-escaped. */
export function sitemapXml(urls: readonly { loc: string; lastmod?: string }[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const body = urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${esc(u.lastmod)}</lastmod>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}${body ? '\n' : ''}</urlset>\n`;
}
