import type { MetadataRoute } from 'next';
import { indexingEnabled } from '../lib/api';
import { siteOrigin } from '../lib/seo';

export const dynamic = 'force-dynamic';

/**
 * robots.txt (SEO.md). While the master switch (flag seo.indexing) is off, everything is
 * disallowed. Internal search results and the JSON API are never crawled. (Staging's edge
 * serves its own disallow-all robots.txt regardless.)
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!(await indexingEnabled())) return { rules: { userAgent: '*', disallow: '/' } };
  const origin = siteOrigin();
  return { rules: { userAgent: '*', allow: '/', disallow: ['/search', '/api/'] }, sitemap: `${origin}/sitemap.xml` };
}
