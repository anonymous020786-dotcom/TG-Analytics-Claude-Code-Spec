# ADR-007 — Admin UI Hosted in the Web Application Initially

Status: Proposed (OD-013)

## Context

`apps/admin/README.md` states the admin UI "may initially share the web application if documented". ROUTES.md lists `/admin/*` alongside public and dashboard routes.

## Decision (proposed)

- Admin pages are served by `apps/web` under `/admin`. `apps/admin` remains a placeholder.
- Every admin action is authorized server-side by the API (RBAC, PHASE-17). Hiding UI elements is not a control.
- Admin routes are `noindex`, excluded from the sitemap, and carry stricter rate limits and audit (PHASE-26).

## Consequences

- One frontend deployment to operate.
- Admin code ships in the same deployment as the public site. Admin bundles must be route-split so they aren't loaded on public pages.
- Extraction to `apps/admin` is possible later without API changes.

## Alternatives considered

- A separate admin app from day one: more isolation, but extra deployment overhead without measured need (ADR-001).
