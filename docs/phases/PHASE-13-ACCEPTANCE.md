# Phase 13 Acceptance Matrix — Public Web

Verified on 2026-09-30 in local staging (`tga-staging`, edge proxy on `127.0.0.1:8088`) with real Telegram data, plus the full CI suite.

## Routes (ROUTES.md)

| Route | Status | Data source | States |
|---|---|---|---|
| `/` | Done | `GET /api/v1/channels` (browse) | Search form; "largest" list omitted while search is off; empty |
| `/search` | Done | `GET /api/v1/channels`, `/search/suggest` (autocomplete) | Results, empty, invalid input, 404 while `search.public` off; cursor pages |
| `/channels` | Done | `GET /api/v1/channels` (members sort, filters) | List, empty filters, 404 while off; cursor pages |
| `/channel/[username]` | Extended | `/channels/:username`, `/channels/:id/stats` | Identity → metrics → growth → chart → posts (unavailable) → freshness; chart skeleton, partial-failure retry; alias → 308 redirect; real 404 |
| `/channel/[username]/statistics` | Done | `/channels/:id/stats` | 7/30/90/365-day tabs, chart, data table, invalid window → default |
| `/channel/[username]/posts` | Done (honest unavailable state) | — | States that post data needs MTProto (OD-003); never an empty list |
| `/rankings`, `/trending` | Done, **flag off** | `/rankings`, `/rankings/:key`, `/trending` | Methodology, disclaimer, run time, empty-before-first-run, cursor pages; 404 and nav hidden until OD-015 |
| `/docs` | Done (methodology) | `GET /api/v1/methodology` | Every metric definition (FR-ANL-01), principles, API summary |
| `/channels/[category]`, `/rankings/[category]` | Deferred (404) | — | No category data or assignment source: **OD-017** |
| `/pricing` | Deferred (404) | — | Needs plans (OD-006): **OD-018** |

## Gates

| Area | Required | Evidence |
|---|---|---|
| FR-PROF-01 | Identity → primary metrics → growth → post analytics → recent posts; loading, empty, error and retry states | E2E checks section order; chart `<Suspense>` skeleton; chart failure renders a retry link; `error.tsx` retry; posts state honest (OD-003) |
| FR-PROF-02 | Public routes exist and read server-side; no live Telegram call per page view | Pages call only the API via `API_INTERNAL_URL` (server-only); API reads stored data; boundary check (web imports only ui/types/validation) |
| No soft 404s | Unknown entities and disabled features return 404 | Existence and availability resolved in `generateMetadata` (request-cached) for entity, list and ranking pages; E2E: unknown channel sub-routes, disabled search, disabled rankings, deferred routes → 404 |
| No invented data | Unavailable is never 0 | Growth "not enough history yet"; chart gaps kept (unit test); anomalies excluded and counted; posts "not available yet" |
| OD-015 gate | No public ranking display before approval | `rankings.public` off by default; verified on with real data in staging (localhost, `noindex`), then turned off; nav links hidden when off (15 s TTL, no stale-while-revalidate) |
| SEO/indexation | Public pages meet SEO rules (OD-008 pending) | Every page `noindex, nofollow`; edge `X-Robots-Tag` and `robots.txt: Disallow: /`; no thin category pages (deferred) |
| Mobile and desktop | Critical paths work | Headless Chrome at 375×812 (mobile, touch), light and dark: channel, statistics, search. Autocomplete with keyboard and ARIA verified in-browser. Fixed after screenshots: tiny chart labels, colliding date labels, clipped readout |
| Accessibility | Accessible controls | Skip link, landmarks, labelled forms, 44 px targets, ARIA combobox, chart `aria-label` summary and data table, visible focus, reduced motion, forced colors |
| Security | Untrusted input and content | No raw-HTML sinks (0 found; Telegram text rendered as text, T03); page params whitelisted before forwarding (unit tests); no internal API address in HTML (E2E); client code imports no server modules |
| API | Validation, stable errors, pagination | New endpoints: `/channels/:id/stats`, `/rankings`, `/rankings/:key`, `/trending`, `/methodology`; 12 e2e tests (flags, anomalies, gaps, windows, hidden entities, cursors, bad input) |
| Performance | Measured, not claimed | Through the edge at 10 req/s (under the 20 r/s page limit): p50 31–41 ms, p95 ≤ 66 ms for all routes; HTML 9.5–23 KB; charts need no client JS. The first attempt tripped the edge rate limiter (429s): expected behaviour, re-measured under the limit |
| Tests | Suites pass | `pnpm run ci` green: 427 tests (15 new web unit, 12 new API e2e), lint, typecheck, boundaries, `db:check`, build, audit. Staging: E2E 10/10 (search on, rankings off), 12/12 (rankings on), disabled-search variant; smoke 8/8 |
| Deferred | Out of scope | Design system and polish (PHASE-15); SEO metadata, sitemap, indexation (PHASE-14, OD-008); OpenAPI (PHASE-22); categories (OD-017); pricing (OD-006/OD-018); post analytics (OD-003) |
