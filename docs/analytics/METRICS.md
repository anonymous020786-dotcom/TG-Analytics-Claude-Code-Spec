# Metric Contract

Every metric defines source, observation time, calculation, window, missing-data behavior, freshness, display label and raw/calculated status.

Examples:
absolute_growth = current - previous_valid
percentage_growth = (current - previous_valid) / previous_valid * 100 when previous_valid != 0

Unavailable metrics remain unavailable; never invent values.

## Data quality (PHASE-10)

Implemented in `@tga/analytics` (pure) and applied by the metrics collector:

| Concern | Rule | Where |
|---|---|---|
| Validation | Raw values must be non-negative, ≤ 10¹⁰, and not observed in the future (5 min skew). Implausible values are rejected before storage (`invalid_input`), and nothing is written. | `checkPlausibility` |
| Freshness | `fresh` until 2× the expected refresh interval, then `stale`. `never` when unobserved (unavailable stays unavailable). | `freshnessOf` |
| Anomalies | Compared with the previous valid observation within 7 days, on bases ≥ 1,000: `drop_to_zero`, `large_increase` / `large_decrease` at ±50%. The raw snapshot is **kept unchanged**; a `metric_anomalies` row flags it for analytics (PHASE-11) and review (PHASE-26). | `detectAnomalies`, `AnomalyRepository` |
| Collection status | `collection_status` (`pending`/`ok`/`failed`) plus `last_collection_error_class`, cleared on success; history untouched on failure (FR-DQ-02). | `ChannelRepository` |
| Display verdict | `unavailable` > `failing` > `never_collected` > `stale` > `ok`, with per-metric freshness and failure cause (FR-DQ-01). | `assessChannelQuality` |

All thresholds are provisional until OD-005 and are passed as parameters, not hard-coded at call sites.

## Registry and calculators (PHASE-11)

The metric contract for every metric lives in code: `METRIC_REGISTRY` in `@tga/analytics`. A test fails if any field is missing. Current entries:

- `members` (raw);
- `members_growth_{1d,7d,30d}` (absolute);
- `members_growth_pct_{1d,7d,30d}` (percentage).

All calculated metrics use `growth-v1`:

- previous_valid is the latest non-anomalous observation at or before `asOf − window`, within the window tolerance;
- current must be at most 1 day old;
- missing inputs make the metric unavailable, and a zero baseline gives a null percentage (ADR-013).
