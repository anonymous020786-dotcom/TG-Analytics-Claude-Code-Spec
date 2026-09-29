# Phase 10 Acceptance Matrix

| Area | Required | Evidence |
|---|---|---|
| Validation | Impossible values rejected before storage; nothing written | `checkPlausibility` tests; collector test (implausible → no snapshot, `invalid_input`) |
| Freshness state | Per-metric fresh/stale/never against refresh intervals | `freshnessOf` tests; live verdicts on dev channels |
| Anomaly detection | Suspicious changes flagged; raw observation kept; idempotent | `detectAnomalies` tests; collector drop-to-zero test; `AnomalyRepository` tests |
| Collection status | Status + failure class recorded; cleared on success; history kept | `qualityView` tests; collector tests |
| No fabrication | Never-observed → `never`/null, never 0; anomalies never alter values | Tests (METRICS.md) |
| Migration | Additive column + new table with CHECKs | `data_quality`, no drift |
| Boundaries | `@tga/analytics` is pure (no I/O imports) | Boundary check (14 packages) |
| Scope | No calculators, rankings or trending (PHASE-11) | Diff review |
