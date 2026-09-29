# apps/web

Next.js public site, authenticated dashboard and admin UI (ADR-007).

Current state (PHASE-11A): placeholder home page and the flag-gated `/channel/[username]` page, rendered server-side from the API (`API_INTERNAL_URL`); everything `noindex` until PHASE-14.

```sh
pnpm --filter @tga/web dev
```
