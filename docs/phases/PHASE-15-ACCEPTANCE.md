# Phase 15 Acceptance Matrix — UI System

Verified on 2026-09-30: unit tests, full CI, staging E2E, and a headless Chrome audit of real staging pages. Accessibility target: WCAG 2.2 AA (provisional until OD-005 sets the level).

| Area | Required | Evidence |
|---|---|---|
| Reusable components | Shared UI library | `@tga/ui`: tokens (`styles.css`) plus 16 server-compatible primitives; no framework imports (link components injected); boundary check: pure library, 17 packages OK |
| Adoption | Pages use the system, not ad-hoc markup | Every notice, card, stat, skeleton, tab strip, pager, table and definition list in `apps/web` now uses `@tga/ui` (0 legacy class usages left); web CSS reduced to site chrome, lists, autocomplete and chart |
| Contrast | AA text 4.5:1; UI and graphics 3:1 | `contrast.test.ts` parses `styles.css`: 14 pairs × 2 themes pass. **Found and fixed:** input, button and tab borders were 1.2:1 (fail 1.4.11), now `--control-border` ≥ 3:1 |
| States | Loading, success, empty, error, retry (NFR-UX-01) | `Skeleton` (announced once), `EmptyState`, `Alert` (live error/status), chart partial-failure retry, `error.tsx` retry; unit tests for roles and labels |
| No color-only meaning | Status needs text/shape | Alert: icon plus hidden tone label; StatusBadge: shape plus text (unit tests) |
| Forms | Labels, hints, errors programmatically linked | `Field` wires `aria-describedby`/`aria-invalid` and throws if the control has no id; search box has a single visible-to-AT label |
| Keyboard | Everything reachable, visible focus | Headless Chrome walk: skip link is the first stop; tabs, pager, summary and the table region (`tabindex=0`, labelled) all reachable; global `:focus-visible` ring (≥ 3:1) |
| Target size | 2.5.8 (24×24) | Breadcrumb links fixed to ≥ 24 px (found in the audit); 0 non-inline targets under 24 px; controls and nav links 44 px |
| Screen readers | Dynamic updates announced | Autocomplete: live status "2 suggestions available; use the arrow keys to choose." (verified in-browser); ARIA combobox from PHASE-13 |
| Automated audit | Measured | Lighthouse accessibility **100** on channel (mobile), statistics (mobile), search (desktop), home (mobile) and methodology (desktop); Best Practices 100. The only failed audit on each is `is-crawlable`, the intentional `noindex` (ADR-016) |
| Responsive | Mobile-first | Single column at 375 px; tables scroll inside their region; `.ui-defs` stacks under 480 px; unchanged E2E at desktop sizes |
| Motion and forced colors | Respect user settings | `prefers-reduced-motion` stops skeleton animation; `forced-colors` keeps borders and current-tab indication |
| Tests | Suites pass | `pnpm run ci` green: 490 tests (+44 in `@tga/ui`: 32 contrast, 12 component); staging E2E 15/15; smoke 8/8 |
| Findings | During the phase | (1) Control-border contrast failure (fixed). (2) Breadcrumb target size (fixed). (3) The boundary checker rejected `fs` in a pure library's test, so the test uses a `?raw` import instead of an exemption. (4) Redeploys show about 10 s of 502s while the proxy's DNS cache (`valid=10s`) catches up. Single-instance staging has a restart gap anyway; zero-downtime deploys are a production-phase item |
| Deferred | Out of scope | WCAG level decision (OD-005); visual polish beyond tokens (no brand assets yet); authenticated dashboard components (PHASE-16+) |
