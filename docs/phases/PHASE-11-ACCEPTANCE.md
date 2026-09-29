# Phase 11 Acceptance Matrix

| Area | Required | Evidence |
|---|---|---|
| Pure calculators | Growth (absolute/%), ranking, trending; no I/O | `@tga/analytics` (boundary-checked pure) |
| Edge cases | No current / no baseline / stale current / zero baseline / negative growth / anomalies / look-ahead / ties / NaN | `engine.test.ts` (20), ranking worker tests (6), DB constraint tests |
| Metric contract (FR-ANL-01) | Every metric fully defined | Registry completeness test |
| Methodology versioning | Version on every result and stored with every run | Tests; `ranking_runs.methodology_version` |
| Rankings (FR-RANK-01) | Metric, window, eligibility, freshness, tie-break, version declared; deterministic | RANKINGS.md table; `rank` tests |
| Trending (FR-TRND-01) | Versioned, documented, labelled non-official | TRENDING.md; disclaimer test |
| Never fabricate | Unavailable inputs excluded, never 0 | Growth and ranking tests; live run (growth rankings empty without baselines) |
| Immutability and idempotency | Runs immutable, unique per (key, version, asOf) | Trigger and idempotency tests |
| Performance | Batched reads (no N+1), bounded batches and outputs | `latestChannelValues` (`DISTINCT ON`, ≤ 1,000 ids), entry limit 1,000 |
| Live pipeline | Scheduler → ranking worker → stored runs | 3 ranking jobs succeeded; `top-subscribers` ranked real channels |
| Bug fixed | PostgreSQL `NaN = NaN` is true, so `score = score` did not exclude NaN | Migration `ranking_score_finite` + direct DB test |
| Open | Owner approval of v1 parameters | OD-015 |
