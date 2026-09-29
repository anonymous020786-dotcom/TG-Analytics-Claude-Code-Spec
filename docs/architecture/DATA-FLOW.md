# Data Flow

Discovery: normalize -> validate -> resolve -> verify supported/public scope -> map -> upsert -> schedule jobs.

Metrics: collect -> validate -> deduplicate -> append snapshot -> analytics event -> aggregation -> cache invalidation/index update.

Alerts: metric event -> rule evaluation -> idempotent alert event -> notification queue -> delivery adapter.

Public reads: CDN/cache -> Next.js/API -> Redis -> PostgreSQL/ClickHouse. Avoid live Telegram calls for every page.
