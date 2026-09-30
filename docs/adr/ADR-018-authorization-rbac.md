# ADR-018 — Authorization: RBAC, Deny-by-Default Guard, Object-Level Checks

Status: Accepted (PHASE-17, 2026-09-30). Organization model: OD-019.

## Context

FR-AUTH-03 requires RBAC with server-side and object-level authorization, with privileged actions audited. The threat model names IDOR (T06: user A must not reach user B's objects) and privilege escalation (T07: hiding UI is not a control). POSTGRESQL.md lists `roles`, `permissions` and `role_permissions`. Admin screens and most privileged actions arrive in PHASE-26. Watchlists, alerts and API keys arrive in PHASE-19/20/23.

## Decision

- **Catalog in the database, changed only by migrations.**
  - Tables: `roles`, `permissions`, `role_permissions`, plus `user_roles` for assignments with `granted_by`.
  - PHASE-17 seeds only what it enforces: role `admin`, holding permission `roles.manage`. Later phases add roles (such as a moderator) and permissions in the migration that ships the endpoints checking them. Nothing is defined ahead of use.
  - The API has a typed permission catalog and **fails at startup** if any of its keys is missing from the database.
- **One guard, deny by default.** `PermissionGuard`, via `@UseGuards` on every protected controller:
  - a route must declare `@Authenticated()` or `@RequirePermission(p)`, otherwise it is refused (403, logged);
  - it resolves the session through `AuthService.authenticate`, which enforces the flag, then 401 for no session, then Origin and CSRF on unsafe methods (JSON body required for POST);
  - it loads the user's permissions from the database **on every request**, so grants and revocations apply immediately;
  - 403 on a missing permission, logged as `authz.denied`.
- **Object-level authorization in the data access, not only in the route.** Operations on user-owned objects filter by owner in the query (`revokeOwned(userId, id)`). Another user's object is indistinguishable from a missing one: **404**, which does not confirm existence. PHASE-19/20/23 follow the same pattern for watchlists, alerts and keys.
- **Privileged actions are audited** in the append-only `audit_logs`, with actor, target, role and request ID: `role.granted`, `role.revoked`, `auth.session_revoked`. Denials go to the security log rather than the audit table, so a flood of denials cannot bloat it.
- **Lock-out protection.** The last holder of a protected role (`admin`) cannot be removed (409). The check locks all holder rows in one transaction, so two admins revoking each other concurrently cannot leave zero admins (tested).
- **Bootstrap:** `roles-cli` (operator, `docker compose exec`, audited as `operator:<id>`) grants the first admin to an account that has signed in once. No default admin exists.

## Consequences

- Adding a permission is a migration plus a code constant plus the endpoint that checks it, all reviewed together.
- Each privileged request costs one indexed permission query. There is no caching, so revocation is effective immediately.
- Organizations (shared ownership) are not modelled yet (OD-019). Object checks are written as owner filters so an organization owner type can be added without changing call sites.
- The web uses `/auth/me` roles for display only. Every decision stays in the API (T07).
