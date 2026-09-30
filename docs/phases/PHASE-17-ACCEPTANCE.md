# Phase 17 Acceptance Matrix — Authorization

Verified on 2026-09-30: repository, API e2e and CLI tests, full CI, and the staging edge. Design: ADR-018.

| Area | Required | Evidence |
|---|---|---|
| Roles and permissions | RBAC catalog | Migration `20260930180907_authorization`: `roles`, `permissions`, `role_permissions`, `user_roles` (key formats checked, FKs, unknown roles rejected by the database). Seeded: `admin` → `roles.manage` only. Staging query confirms `admin` holds `roles.manage` |
| Guards | Server-side enforcement on every protected route | `PermissionGuard` on the sessions and admin controllers: 401 without a session, 403 without the permission (denial logged with user, permission, route), Origin + CSRF on changes. Deny-by-default test: a route without a declared requirement is refused before any lookup |
| Immediate effect | Role changes apply at once | e2e: a user granted `admin` can use the admin API with the same session; after revocation it gets 403 on the next request |
| Object-level (FR-AUTH-03, T06) | User A cannot read/modify user B's objects | e2e: sessions list shows only own sessions; A ending B's session → 404 and B stays signed in; malformed id → 404. Staging edge: the same IDOR check → 404 |
| Privilege escalation (T07) | No privileged action without permission | e2e: a normal user's grant attempt → 403 and no role written; anonymous → 401; staging edge: 403 / 401 |
| Audit | Privileged actions audited | `role.granted` / `role.revoked` (actor, target, role, request id), `auth.session_revoked`; CLI entries as `operator:<id>` with `via: roles-cli` |
| Lock-out protection | Last admin cannot be removed | API → 409 `last_role_holder`; CLI refuses; repository race test: two admins revoking each other concurrently → exactly one succeeds, one admin remains |
| Validation | Every input checked | UUID and role-key formats; unknown user or role → 404; CSRF missing → 403 with no change |
| Bootstrap | First admin without a default account | `roles-cli grant/revoke/list` by Telegram user id; tested for usage errors, unknown account, idempotent grant, unknown role, last admin; runs in the staging scheduler container |
| Startup safety | Code and database catalogs agree | API refuses to start when a code permission is missing from the database (`assertCatalog`) |
| Web | Own sessions manageable | `/account`: roles (display only), active sessions with device and time, end any session, sign out everywhere |
| Tests | Suites pass | `pnpm run ci` green: 559 tests (+4 repository incl. race, +10 authz e2e); staging auth-flow E2E 6/6; PHASE-16 auth e2e unchanged (16/16) |
| Findings | Fixed during the phase | Nest instantiates `@UseGuards` classes through DI, so a pre-built guard instance was ignored (dependencies undefined → 500). The guard is now `@Injectable` with its dependencies behind a DI token |
| Deferred | Out of scope | Organizations (OD-019); moderator role and moderation permissions (PHASE-26); user administration and admin screens (PHASE-26); object checks for watchlists, alerts and API keys (PHASE-19/20/23, same pattern) |
