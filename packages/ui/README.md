# packages/ui

Shared design system (`@tga/ui`, PHASE-15): design tokens (`styles.css`) and server-compatible React primitives. No framework imports: components that render links take a link component from the app (Next.js `Link`). No hooks and no client components, so everything renders on the server. Accessibility target: WCAG 2.2 AA (provisional, OD-005); token contrast is checked by a unit test.
