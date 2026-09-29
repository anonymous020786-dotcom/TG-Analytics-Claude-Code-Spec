# ADR-013 — Analytics Engine and Methodology Versioning

Status: Accepted (PHASE-11, 2026-09-29)

## Context

PHASE-11 requires pure calculators, methodology versioning and edge-case tests. METRICS.md requires every metric to declare its contract and never invent values. RANKINGS.md requires metric, window, eligible population, freshness rule, tie-break and methodology version. TRENDING.md requires a versioned, documented, non-official signal.

## Decision

- **Pure calculators** in `@tga/analytics` (no I/O, callers pass `asOf`):
  - `growth()` (absolute and percentage);
  - `rank()`;
  - `trendingScoreV1()`.

  Unavailable inputs produce `available: false` with a reason, never 0. A zero baseline gives a `null` percentage.
- **Metric registry** (`METRIC_REGISTRY`): the single source of each metric's contract. A test fails if a field is missing.
- **Methodology versions** are carried in every result and stored with every ranking run (`growth-v1`, `rank-members-v1`, `rank-growth7d-v1`, `trending-v1`). Any change to rules, weights, windows or eligibility means a **new version**, never an in-place edit.
- **Anomalies:** growth-v1 excludes observations flagged by PHASE-10 from both current and baseline, so a glitch cannot win a ranking.
- **Rankings are immutable runs:**
  - `ranking_runs` plus `ranking_snapshots`, unique per (ranking, version, asOf); UPDATE is blocked by trigger.
  - `asOf` is the scheduler window boundary, so recomputation is idempotent.
  - Ties go to the lower channel id (UUID v7: earliest discovered).
- **Batch reads:** `latestChannelValues` uses one `DISTINCT ON` query per batch of up to 1,000 channels, excluding anomalies, to avoid N+1 queries.
- **`analytics_events`** (CLICKHOUSE.md) is not created yet. No consumer needs it before alerts (PHASE-20), which will define it (updates D-014).

## Consequences

- Historical rankings stay reproducible and auditable by version.
- The ranking and trending parameters (eligibility base 1,000, freshness 1 day, trending weights 0.7/0.3) are proposals until owner approval (OD-015). Approving different values creates new versions.
- Rankings are computed in memory over the eligible population. PHASE-33 measures when that needs streaming or SQL-side ranking.
