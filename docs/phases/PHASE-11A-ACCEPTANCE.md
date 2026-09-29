# Phase 11A Acceptance Matrix — Vertical Slice

| Area | Required | Evidence |
|---|---|---|
| Feature flag | Slice hidden unless `slice.channel-page` is on; unknown flags fail closed | API e2e (404 while off); flag toggled via audited `flags-cli` |
| Discovery → snapshot | Real adapter, queues, workers, storage | Live: `t.me/durov` queued by `discover-cli` → discovery, metadata, metrics jobs `succeeded` |
| Metric + analytics | Growth and freshness from shared pure analytics; no fabrication | API returns members 10,587,845; 7 d growth `no_baseline` (not 0); verdict `ok` |
| Read endpoint | `GET /api/v1/channels/:username`: validation, stable errors, request id, 404 for hidden/non-active/unknown, alias resolution | API e2e tests (11) |
| Page | `/channel/[username]` server-rendered via the API (no DB access from web); `noindex`; disclaimer; not-found and error states | Live HTML; boundary check (web imports no DB/queue packages) |
| Real 404s | Unknown channel → HTTP 404 (no soft 404), for browsers and Googlebot | Live curl; rule recorded in UI-UX.md |
| Containers | API and web run in compose against real services | Compose: API healthy, page 200, unknown 404, non-root, no sources in image |
| Security | No Telegram calls on reads; username validated before DB; web never sees DB credentials | Code review; e2e tests |
| Findings | Next.js route-level `loading.tsx` causes soft 404s; API image COPY list was brittle | Loading boundary removed + rule; Dockerfile assembly stage |
| Deferred | Rate limiting, OpenAPI, caching (PHASE-22/23); SEO/indexing (PHASE-14); UI system (PHASE-15); image size 730 MB (PHASE-29/35) | Documented |
