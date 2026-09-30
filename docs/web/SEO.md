# SEO

Implement unique title, description, canonical, robots, OpenGraph/Twitter metadata, JSON-LD, breadcrumbs, sitemap and robots.txt.

Only index pages with meaningful/current-enough data. Programmatic SEO must not fabricate statistics or create mass thin pages.

## Implementation (PHASE-14, ADR-016)

| Item | Where |
|---|---|
| Unique title and description, canonical, robots, Open Graph, Twitter | `pageMetadata()` in `apps/web/lib/seo.ts`, used by every route's `generateMetadata` |
| Indexation gate | Flag `seo.indexing` (master switch, off) AND the per-page rule; channel rule in `ChannelRepository.indexableWhere` |
| JSON-LD | `WebSite` + `SearchAction` (home), `WebPage` about the entity (channel), `BreadcrumbList` (breadcrumb pages); escaped by `jsonLd()` |
| Breadcrumbs | Visible `<nav aria-label="Breadcrumb">` plus JSON-LD |
| `robots.txt` | `apps/web/app/robots.ts`: disallow all while off; otherwise allow, except `/search` and `/api/`, and link to the sitemap |
| Sitemap | `/sitemap.xml`: indexable pages only; empty while off |

### What is never indexed

`/search` (internal search results), filtered or paginated lists, `/channel/*/posts` (no content yet), 404 pages, and channel pages that fail the data rule (default: fewer than 1,000 subscribers, a stale or anomalous count, or less than 7 days of history). Thresholds: OD-008.
