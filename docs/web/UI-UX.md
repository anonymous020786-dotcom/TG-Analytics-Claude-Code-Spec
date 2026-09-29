# UI/UX

Principles: hierarchy, fast perceived performance, clear metric definitions, mobile-first interaction, accessible controls and consistent design.

Required states: loading, success, empty, error, retry.

Channel page: identity -> primary metrics -> growth -> post analytics -> recent posts.
Dashboard: overview -> tracked channels -> alerts -> exports/API -> billing/settings.

## Rule: no route-level loading boundary on entity pages (PHASE-11A finding)

A route-level `loading.tsx` makes Next.js start streaming a `200` response before the page can call `notFound()`, so unknown entities return **soft 404s** (verified on Next 16.3.5, for browsers and Googlebot). Entity routes (`/channel/[username]`, and later category/ranking pages) therefore:

- resolve existence in `generateMetadata` (deduplicated with React `cache()`), so a missing entity returns a real `404`;
- put loading states only on in-page `<Suspense>` boundaries around secondary sections, after existence is known (PHASE-15).
