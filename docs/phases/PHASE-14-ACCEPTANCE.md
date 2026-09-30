# Phase 14 Acceptance Matrix — SEO

Verified on 2026-09-30 in local staging (edge on `127.0.0.1:8088`) with real Telegram data, in both states of the master switch, plus the full CI suite. Design: ADR-016.

| Area | Required (SEO.md, FR-SEO-01) | Evidence |
|---|---|---|
| Titles and descriptions | Unique per page; no fabricated statistics | `pageMetadata()` on every route; E2E asserts a unique title per canonical URL and a description of at least 20 characters; channel descriptions include a count only when observed (unit test) |
| Canonical | One canonical URL per page | From `PUBLIC_SITE_URL` (validated origin, unit tests reject paths, credentials and other schemes); `?days`, `?cursor` and filters canonicalize to the base path (E2E); aliases 308 to the current username |
| Robots | Only meaningful, current pages indexable | Master switch `seo.indexing` (off) AND per-page rule. E2E off: every page `noindex`. E2E on: home and docs `index, follow`; `/search`, filtered `/channels` and `/posts` `noindex`; the `telegram` channel `noindex` (under 7 days of history, by rule) |
| Indexation rule | Threshold (OD-008) | One SQL definition for page and sitemap; boundary tests for each condition: members, freshness, history, status, hidden, failing collection, anomaly; view and sitemap agree (10 API e2e tests). Values are a proposal pending OD-008 |
| Open Graph / Twitter | Present | `og:title`, `og:description`, `og:url`, `og:site_name`, `twitter:card=summary` on every public page (E2E) |
| JSON-LD | Valid structured data | `WebSite` + `SearchAction` (home), `WebPage` about the entity (channel), `BreadcrumbList` (E2E parses every block) |
| Breadcrumbs | Visible and structured | Channel, statistics, posts and methodology pages: `<nav aria-label="Breadcrumb">` plus a matching `BreadcrumbList` |
| Sitemap | Indexable pages only | `/sitemap.xml`: an empty valid `urlset` while off; on: home, `/channels`, `/docs` and only rule-passing channels (staging: none yet); XML-escaped (unit test); 5–20 ms |
| `robots.txt` | Correct per state | App route: disallow all while off; on: allow, except `/search` and `/api/`, plus the sitemap link (verified inside the web container). The staging edge serves disallow-all regardless |
| No thin pages | CLAUDE.md "Never do" | New channels wait at least 7 days and must reach 1,000 subscribers; search and filter variants are never indexed; category pages stay deferred (OD-017) |
| Security | Untrusted text cannot inject markup | JSON-LD is the only raw-HTML sink and escapes `<`, `>`, `&`, U+2028/2029 (unit test with a `</script>` payload); `PUBLIC_SITE_URL` validated; fail closed on API errors |
| Performance | No regression | Through the edge at 10 req/s: p50 33–38 ms, p95 ≤ 59 ms (PHASE-13: 31–41 / 66); HTML +2–6 KB for metadata |
| Findings | Fixed during the phase | (1) The staging nginx resolved upstreams once at startup: after a web recreate it routed traffic to the API container's recycled IP (502s). Fixed with Docker DNS re-resolution; verified by recreating web. (2) A tooling pitfall wrote raw U+2028 characters into source; caught by the test transform and fixed, and the escaping test now covers it |
| Tests | Suites pass | `pnpm run ci` green: 446 tests. Staging E2E 15/15 (off) and SEO checks all passing (on); smoke 8/8 |
| Deferred | Out of scope | OD-008 approval; production domain (OD-016); sitemap index above 50,000 URLs (PHASE-35); Open Graph images; category pages (OD-017) |
