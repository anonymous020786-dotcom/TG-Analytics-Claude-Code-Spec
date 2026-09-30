import { fetchRankings, fetchSitemapChannels, indexingEnabled } from '../../lib/api';
import { absoluteUrl, siteOrigin, sitemapXml } from '../../lib/seo';

export const dynamic = 'force-dynamic';

/** Sitemap protocol limit for one file; a sitemap index is needed beyond this (PHASE-35). */
const MAX_URLS = 50_000;

/**
 * sitemap.xml: only pages that are indexable right now. Empty while seo.indexing is off.
 * Channel pages come from the API's indexation rule (the same SQL as the per-page robots).
 */
export async function GET(): Promise<Response> {
  const origin = siteOrigin();
  const urls: { loc: string; lastmod?: string }[] = [];
  if (await indexingEnabled()) {
    urls.push({ loc: `${origin}/` }, { loc: absoluteUrl('/channels', origin) }, { loc: absoluteUrl('/docs', origin) });
    const rankings = await fetchRankings().catch(() => null);
    if (rankings?.kind === 'ok') urls.push({ loc: absoluteUrl('/rankings', origin) }, { loc: absoluteUrl('/trending', origin) });
    for (const c of await fetchSitemapChannels(MAX_URLS - urls.length)) {
      urls.push({ loc: absoluteUrl(`/channel/${c.username}`, origin), lastmod: c.lastModified });
    }
  }
  return new Response(sitemapXml(urls), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
