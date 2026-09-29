# workers/scheduler

Collection scheduler (`@tga/worker-scheduler`, ADR-012): lease-held singleton that enqueues `channel.metrics` / `channel.metadata` for due channels.

- Run: `pnpm --filter @tga/worker-scheduler build && pnpm --filter @tga/worker-scheduler start:local`
- Dead letters: `pnpm --filter @tga/worker-scheduler dlq:local list` and `... dlq:local redrive <jobId> --actor <operator-id>` (audited)
