# ADR-016 — SEO Metadata and Indexation Gate

Status: Accepted (PHASE-14, 2026-09-30). Threshold values approved (D-018, was OD-008). Production domain: OD-016.

## Context

SEO.md requires unique titles and descriptions, canonical URLs, robots, Open Graph/Twitter, JSON-LD, breadcrumbs, a sitemap and `robots.txt`. It also requires that only pages with meaningful, current data are indexed, with no fabricated statistics and no mass thin pages (CLAUDE.md "Never do"). The indexation threshold is an owner decision (OD-008), and no production domain exists yet.

## Decision

- **Two layers of gating.**
  1. **Master switch:** feature flag `seo.indexing` (off by default). While it is off:
     - every page is `noindex, follow`;
     - `robots.txt` disallows everything;
     - the sitemap is an empty `urlset`.
  2. **Per-page rule.** With the switch on:
     - home, `/docs`, the unfiltered first page of `/channels`, and the first pages of `/rankings` and `/trending` (only while `rankings.public` is on) are indexable;
     - `/search`, filtered or paginated variants, `/posts` and every 404 are always `noindex, follow`;
     - channel and statistics pages follow the data rule below.
- **Data rule (one SQL definition).** A channel page is indexable only when the channel:
  - is visible (not hidden, active, has a public username);
  - has collection status `ok`;
  - has at least `SEO_MIN_MEMBERS` subscribers, with a current count no older than 2× the metrics interval;
  - has a current observation that is not flagged anomalous;
  - has at least `SEO_MIN_HISTORY_DAYS` of history (an observation at least that old exists).

  `ChannelRepository.indexableWhere` is used by both the per-page check and the sitemap, so they cannot disagree. The thresholds are configuration, with defaults 1,000 and 7 days, **approved as D-018**.
- **Fail closed.** The web reads the switch through a 15 s in-process memo. An API error means "not indexing", and the root layout defaults to `noindex`. The staging edge always adds `X-Robots-Tag: noindex` and its own disallow-all `robots.txt`.
- **Canonical URLs** come from `PUBLIC_SITE_URL` (origin only, validated). Query variants (`?days`, `?cursor`, filters) canonicalize to the base path. `?ranking=` is kept because it identifies distinct content. Alias usernames already 308-redirect to the current one.
- **Structured data:**
  - `WebSite` with `SearchAction` on the home page;
  - `WebPage` about the Telegram entity (`sameAs` the `t.me` link, `dateModified` = observation time) on channel pages;
  - `BreadcrumbList` wherever there are visible breadcrumbs.

  Types are chosen to describe the page honestly; no follower `interactionStatistic` is claimed. JSON-LD is the only raw-HTML sink, produced by `jsonLd()`, which escapes `<`, `>`, `&` and U+2028/2029 (THREAT-MODEL T03, unit-tested with a `</script>` payload).
- **Descriptions** are built only from observed values. A count appears only when one was collected, and there is no templated filler per entity.
- **Sitemap:** one file up to the 50,000-URL protocol limit, built from the API's cursor-paged list of indexable channels (5,000 per request). A sitemap index is needed beyond that (PHASE-35).

## Consequences

- Nothing can be indexed by accident: two independent switches (flag and data rule) plus the staging edge.
- Changing the threshold after OD-008 is a configuration change, not a code change.
- A channel only becomes indexable a week after discovery (default rule), so new entries will not produce thin pages.
- Found during verification: the staging nginx resolved upstream names only at startup and routed web traffic to a recycled IP after a container was recreated. Fixed with `resolver 127.0.0.11` and `server … resolve` (nginx ≥ 1.27.3), keeping keep-alive pooling.
