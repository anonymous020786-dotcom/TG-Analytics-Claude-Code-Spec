# Phase 05 Acceptance Matrix

| Area | Required | Evidence |
|---|---|---|
| Storage abstraction | Callers depend on an interface, not a datastore | `AnalyticsStore` in `@tga/types`; `PostgresAnalyticsStore` implements it |
| Snapshot model | Raw observations per (entity, metric, observed_at) with source and job provenance | Migration `analytics_snapshots` |
| Append-only | No overwrite; UPDATE blocked in the database | Trigger + test (`append-only`) |
| Idempotent appends | Re-appending an observation is skipped and reported as a duplicate | `analytics-store.test.ts` |
| No fabricated values | Never-observed metrics return empty/null; real zeros are kept | `analytics-store.test.ts` |
| Validation | Whole batch validated before any write; DB CHECKs as second line | `@tga/types` tests (15); DB constraint tests |
| Bounds | Batch ≤ 1,000; series ≤ 5,000 points (provisional, OD-005) | Tests |
| History kept | Entities with snapshots cannot be deleted | FK `RESTRICT` test |
| Datastore decision | ClickHouse deferred until measured need | ADR-011, D-014 |
| Scope | No collectors, calculators, rankings or events | Diff review |
