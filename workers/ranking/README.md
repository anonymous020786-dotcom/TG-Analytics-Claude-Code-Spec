# workers/ranking

Ranking computation (`@tga/worker-ranking`, ADR-013): consumes `ranking.compute`, scores the eligible population from stored snapshots (batched reads), ranks with `@tga/analytics` and saves an immutable run. Never calls Telegram.

Run: `pnpm --filter @tga/worker-ranking build && pnpm --filter @tga/worker-ranking start:local`
