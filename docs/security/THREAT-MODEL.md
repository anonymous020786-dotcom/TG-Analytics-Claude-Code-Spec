# Threat Model

For every material threat record: asset, attacker, entry point, impact, likelihood, prevention, detection, response and verification test.

Review after major architecture changes.

Status: initial model from PHASE-01 (D-010, P6), based on SYSTEM-ARCHITECTURE.md and SECURITY.md. Likelihood is a qualitative initial estimate (H/M/L), re-assessed in PHASE-28. Component IDs (C1–C12) are from SYSTEM-ARCHITECTURE.md.

## Threats

| ID | Threat | Asset | Attacker → entry point | Impact | Lik. | Prevention | Detection → response | Verification test (phase) |
|---|---|---|---|---|---|---|---|---|
| T01 | Account takeover / brute force | User accounts, paid access | External → login, reset (C2) | Data/billing misuse | H | Password hashing, rate limits + lockout/backoff, single-use expiring reset tokens, secure sessions | Failed-login metrics, audit → lock, notify user | Repeated failed logins are throttled; reused reset token rejected (16) |
| T02 | SQL injection | PostgreSQL data | External → any API input | Data breach | M | Parameterized queries only; schema validation | Error-rate alerts, DB audit → patch, rotate | Injection payloads in every filter/search param return 400 and no DB error (04, 22) |
| T03 | Stored XSS via Telegram content | Visitors' sessions | Malicious channel/group owner → titles, descriptions, post text rendered in C1 | Session theft, defacement | H | Treat all Telegram data as untrusted; framework escaping; no raw HTML rendering; strict CSP | CSP violation reports → purge/hide entity | Entity fixture with script/HTML payloads renders inert (13, 28) |
| T04 | CSRF | Authenticated state changes | External site → browser of logged-in user | Unwanted changes | M | SameSite cookies + CSRF token strategy | Log rejected tokens | State-changing request without token rejected (16) |
| T05 | SSRF | Internal network, cloud metadata | External → URL/username submission, webhook URLs | Internal access | M | Discovery accepts only Telegram usernames/`t.me` links normalized to usernames; no server-side fetch of user URLs; egress allow-list | Egress denials logged → block | Non-Telegram URLs rejected before any network call (07) |
| T06 | IDOR | Watchlists, alerts, API keys, exports | Authenticated user → object IDs in API | Cross-tenant data access | H | Object-level authorization in application services | 403 spikes → investigate | User A cannot read/modify user B's objects (17, 19, 20, 23) |
| T07 | Privilege escalation | Admin functions | Authenticated user → admin routes/API (ADR-007) | Full compromise | M | Server-side RBAC on every admin endpoint; UI hiding is not a control | Audit log alerts on privileged actions | Non-admin receives 403 on every `/admin` API (17, 26) |
| T08 | API abuse / data exfiltration | Collected dataset, infrastructure cost | API key holder or anonymous scraper → public API/pages | Cost, dataset copying | H | Per-key quotas, rate limits, pagination caps, CDN caching | Usage anomalies → throttle/revoke key | Over-limit requests receive 429 (22, 23) |
| T09 | Queue poisoning | Workers, data integrity | Attacker with enqueue path, or a bug → job payloads | Worker crash, corrupt data | L | Versioned payload schemas validated on enqueue and consume; IDs only in payloads; private Redis | DLQ growth alert → inspect, re-drive | Malformed/unknown-version payload goes to DLQ, not processed (08, 09) |
| T10 | Webhook spoofing / replay | Subscriptions, entitlements | External → payment webhook endpoint | Free paid access | H | Signature verification, provider event-ID idempotency, no access from redirects | Invalid-signature alerts | Forged and replayed webhooks grant nothing (24) |
| T11 | Payment fraud | Revenue | External → checkout | Chargebacks | M | Provider-side fraud tools; entitlements only on verified events | Chargeback events → revoke per policy | Cancelled/failed payment events remove entitlement (24, 25) |
| T12 | Secret leakage | DB creds, bot token, MTProto `api_hash` + sessions, payment keys | Insider/attacker → repo, logs, images, CI | Account/infra takeover | M | Secret store; `.gitignore`; secret scanning in CI (P3); log redaction; no secrets in job payloads | Secret-scan alerts → rotate immediately | CI secret scan passes; log scan finds no tokens (02, 27) |
| T13 | Dependency compromise | Build and runtime | Upstream package → supply chain | Arbitrary code execution | M | Lockfiles, dependency audit in CI (P3), minimal dependencies, pinned container bases | Audit alerts → patch/pin | CI fails on critical advisories (02, 29) |
| T14 | Telegram account ban / credential misuse | MTProto accounts, collection capability | Our own over-collection, or stolen session | Collection outage, ToS breach | M | Shared rate limiter, honor flood waits, no limit evasion, sessions as secrets (ADR-005, OD-003) | `authorization` failure class → stop using the account, alert | Flood-wait response is never retried early (06) |
| T15 | Privacy harm from group data | Individuals in public groups | Any viewer → our pages/API | Profiling of individuals, legal exposure | M | DATA-POLICY §4: no sender identities, no member lists, no group message text | Moderation reports → hide entity (FR-MOD-01) | Group collectors persist no user identifiers (08, 10) |
| T16 | Discovery abuse / thin-page spam | SEO reputation, crawl budget | External → mass discovery submissions | Spam pages, cost | M | Rate-limited submissions, idempotent discovery, indexation threshold (OD-008) | Submission spikes → throttle | Entities below threshold are `noindex` and absent from sitemap (07, 14) |
| T17 | Exposed datastores | All data | External → PostgreSQL/Redis/search ports | Full breach | L | Private network only (DEPLOYMENT.md), auth on all datastores | Port scans in staging/prod checks | External port scan finds only 80/443 (11B, 31) |

## Review triggers

Update this model when a phase adds a new entry point, datastore, provider or privileged action, and in PHASE-28 (full review).
