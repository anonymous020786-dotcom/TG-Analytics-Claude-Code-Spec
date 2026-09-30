# UI/UX

Principles: hierarchy, fast perceived performance, clear metric definitions, mobile-first interaction, accessible controls and consistent design.

Required states: loading, success, empty, error, retry.

Channel page: identity -> primary metrics -> growth -> post analytics -> recent posts.
Dashboard: overview -> tracked channels -> alerts -> exports/API -> billing/settings.

## Rule: no route-level loading boundary on entity pages (PHASE-11A finding)

A route-level `loading.tsx` makes Next.js start streaming a `200` response before the page can call `notFound()`, so unknown entities return **soft 404s** (verified on Next 16.3.5, for browsers and Googlebot). Entity routes (`/channel/[username]`, and later category/ranking pages) therefore:

- resolve existence in `generateMetadata` (deduplicated with React `cache()`), so a missing entity returns a real `404`;
- put loading states only on in-page `<Suspense>` boundaries around secondary sections, after existence is known (PHASE-15).

## Public web rules (PHASE-13)

- **Existence first, everywhere.** Entity pages, list pages (`/search`, `/channels`) and feature-gated pages (`/rankings`, `/trending`) resolve existence or availability in `generateMetadata` (request-cached), so disabled features and unknown entities are real 404s.
- **States:** a loading skeleton only inside in-page `<Suspense>` (charts), plus empty, invalid-input and not-found states. Page errors show a retry button (`error.tsx`). A failing chart is a partial failure: the page renders with a retry link.
- **No invented data:** unavailable values say so (never `0`). Post sections state that post data is not collected yet (OD-003) instead of showing an empty list. Chart gaps stay gaps.
- **Charts:** server-rendered SVG, no client JS. Single series with no legend: the heading names it. The 2px line uses the validated palette slot 1, with its own dark-mode step. Hover gives a crosshair and value (CSS + native tooltip). There is a data table view and an `aria-label` summary. At most 4 x-labels, and labels are enlarged on narrow screens.
- **Progressive enhancement:** search and filters are plain GET forms; autocomplete (ARIA combobox, keyboard) enhances them.
- **Telegram text is untrusted:** rendered as text only (no raw HTML sinks; THREAT-MODEL T03).
- **Mobile-first:** single column, 16 px gutter, 44 px touch targets, no horizontal scroll (tables scroll inside their own container).

## Design system (PHASE-15, `packages/ui`)

- **Tokens** live in `@tga/ui/styles.css`: surfaces, text, link, focus, control border, status and chart colors, spacing, 44 px tap size. Dark mode is its own selected set. `src/contrast.test.ts` parses the file and checks every text pair at 4.5:1 and every control, focus and graphic pair at 3:1 in both themes.
- **Primitives** are server-compatible React with no framework imports:
  - Button, Card, StatCard/StatGrid, Alert, EmptyState, Skeleton;
  - StatusBadge/FreshnessBadge, Field;
  - LinkTabs, CursorPager (these take the app's `Link`);
  - DataTable, DefinitionList, SkipLink, VisuallyHidden.
- **Accessibility contract built into the components:**
  - tone is always icon + text (never color alone);
  - unavailable metrics render explicit text (never 0);
  - fields wire `aria-describedby`/`aria-invalid`;
  - live alerts use `role=alert` for errors and `role=status` otherwise;
  - wide tables scroll inside a labelled, focusable region;
  - skeletons announce once;
  - list-style links have targets of at least 24 px (2.5.8);
  - autocomplete announces the suggestion count politely.
- **Target:** WCAG 2.2 AA (provisional until OD-005 sets the level).
