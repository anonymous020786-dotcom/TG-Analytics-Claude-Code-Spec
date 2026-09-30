# ADR-017 — Accounts: Sign in with Telegram, Server-Side Sessions, CSRF

Status: Accepted (PHASE-16, 2026-09-30). Identity method decided by the owner (D-021). Live widget sign-in needs a public domain (OD-016).

## Context

FR-AUTH-01/02 require account sign-in, sign-out and secure sessions with a CSRF strategy (THREAT-MODEL T01, T04). The owner chose Telegram as the only identity provider: no custom email/password sign-up, email verification or password reset (D-021). The site already serves the browser and the API from one origin through the edge proxy.

## Decision

- **Identity: Telegram Login Widget** (core.telegram.org/widgets/login). The widget returns the user's fields and `hash = hex(HMAC-SHA256(data_check_string, SHA256(bot_token)))`.
  - `@tga/auth` verifies it:
    - field shapes bounded (flat, at most 12 fields, 512 characters, no control characters);
    - signature checked first, with a timing-safe compare;
    - then `auth_date` freshness (at most 10 minutes; at most 60 s in the future).
  - Only a party holding the bot token can sign, so a verified payload proves Telegram authenticated this user for our bot.
  - **Callback mode only.** The signed payload is POSTed with a CSRF token. The widget's redirect mode would create a session from a GET request (login CSRF).
- **Accounts:** `users` keyed by the Telegram user ID, created on first sign-in. We store first and last name and a lowercased username, refreshed on each sign-in. No phone number, no photo, no email (DATA-POLICY).
- **Sessions:**
  - Server-side in `user_sessions`. The cookie carries an opaque 256-bit token, and only its SHA-256 is stored, so a database leak does not yield sessions.
  - The cookie is `__Host-tga_session`: `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`.
  - Absolute lifetime of 30 days; idle lifetime of 7 days, sliding and never beyond the absolute limit (provisional, OD-005).
  - A new session on every sign-in, with the previous one revoked (session fixation).
  - Sign-out revokes the current session; "sign out everywhere" revokes all.
  - A disabled user has no active sessions.
- **CSRF (FR-AUTH-02, T04).** Every state-changing request needs:
  1. `Content-Type: application/json`, which forms cannot send cross-site;
  2. an `Origin` exactly equal to `PUBLIC_SITE_URL`;
  3. `X-CSRF-Token` = HMAC(`CSRF_SECRET`, binding).

  The binding is the session ID when signed in, or, before sign-in, a random nonce in the `__Host-tga_pre` cookie, which also stops login CSRF. `GET /api/v1/auth/session` returns the token. Tokens are stateless, bound to the session, and useless after it changes.
- **Enumeration and errors:**
  - every failed verification returns the same `401 invalid_login`;
  - the reason (bad signature, expired, malformed) goes only to the security log, never the payload;
  - successes are appended to `audit_logs`.
- **Abuse:** the edge applies a stricter per-IP limit on `/api/v1/auth/` (10 requests per minute, burst 20; provisional). Forging a signature is infeasible, so there is no password to brute-force.
- **Exposure:**
  - the routes exist only when `TELEGRAM_LOGIN_BOT_TOKEN`, `TELEGRAM_LOGIN_BOT_USERNAME` and `CSRF_SECRET` are all set;
  - they answer only while flag `auth.login` is on (off by default: 404, and `/login` and `/account` return 404 too);
  - responses are `Cache-Control: no-store`.
- **Web:**
  - `/login` loads the widget script from `telegram.org` on that page only; `/account` shows the user and sign-out;
  - the header shows "Sign in" or the user's name;
  - `?next=` accepts only same-site paths (open-redirect protection);
  - the web server reads the session server-side through `GET /api/v1/auth/me`, forwarding only the session cookie. Pages never make access decisions; the API does.

## Alternatives considered

- **Email and password:** rejected by the owner (D-021). It would also need email delivery, password storage and reset flows.
- **Widget redirect mode (GET callback):** simpler, but it creates a session from a GET and invites login CSRF.
- **JWT in localStorage:** not revocable, and exposed to XSS. Server-side sessions with an HttpOnly cookie are revocable and invisible to scripts.

## Consequences

- No passwords, email or recovery flows to secure. Account recovery is Telegram's responsibility. Later notifications go through the Telegram bot, not email.
- Sign-in depends on Telegram's availability and on the widget script from `telegram.org`. A Content Security Policy must allow it on `/login` (security-headers phase).
- The login bot must have the site's domain set in BotFather (`/setdomain`). Until a public domain exists (OD-016), staging verifies the flow with payloads signed exactly as Telegram does; the live widget cannot render on `127.0.0.1`.
- Found during verification: Next 16 streams metadata for regular browsers, so `notFound()` in `generateMetadata` alone produced soft 404s on `/login`. Pages now also gate in the page component (UI-UX.md).
