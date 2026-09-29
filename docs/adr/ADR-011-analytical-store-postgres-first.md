# ADR-011 — Analytical Store: Interface First, PostgreSQL Before ClickHouse

Status: Accepted (PHASE-05, 2026-09-29)

## Context

PHASE-05 requires an analytical storage abstraction and a historical snapshot model. ADR-002 reserves ClickHouse for high-volume analytical and time-series workloads "when justified". CLAUDE.md forbids adding infrastructure without measured need. No data volume or capacity target exists yet (OD-005).

## Decision

- Callers depend only on the `AnalyticsStore` interface in `@tga/types`: append channel/post snapshots, bounded series queries, latest value.
- The first implementation, `PostgresAnalyticsStore`, lives in `@tga/database` and uses `channel_metric_snapshots` and `post_metric_snapshots`.
- **Snapshot model:**
  - One narrow row per `(entity, metric, observed_at)`, holding a raw non-negative `bigint` value, its `source` (`bot_api` | `mtproto`) and the collection `job_id`.
  - Subscriber, view and engagement snapshots (CLICKHOUSE.md) are metrics in these tables rather than separate tables.
- **Append-only:**
  - UPDATE is blocked by trigger.
  - A duplicate observation is skipped, never overwritten, so appends are idempotent.
  - DELETE is reserved for the retention and removal policy (OD-004).
- **Missing data:** a metric that was not observed has no row. The store never writes or returns a fabricated 0 (METRICS.md).
- **Bounds:** at most 1,000 snapshots per append and 5,000 points per series query (provisional until OD-005). Batches are validated before any write.
- **ClickHouse trigger:** a ClickHouse implementation of the same interface is added only when PHASE-32/33 measurements show PostgreSQL cannot meet the agreed targets. That change must be recorded as an ADR.

## Consequences

- There's no second datastore to operate before it's needed. Swapping the backend later requires no caller changes.
- At high volume, PostgreSQL may need time partitioning or a move to ClickHouse. PHASE-33 scale tests decide.
- `ranking_snapshots` and `analytics_events` are produced by PHASE-11 and are created there (D-014).
