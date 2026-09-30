# Trending

A calculated discovery signal, not an official Telegram ranking.

Possible inputs: subscriber growth velocity, view velocity, recent activity, engagement and freshness. Version the methodology and document weights/windows.

## trending-v1 (PHASE-11)

`score = 0.7 × members growth % (1 d) + 0.3 × members growth % (7 d)`

- **Inputs:** only member growth, the only verified data today (CAPABILITY-MATRIX). View velocity, recent activity and engagement join in a later version once MTProto data exists (OD-003).
- **Windows and tolerances:** as in `GROWTH_WINDOWS` (1 d baseline ±12 h, 7 d baseline ±1 d; current value ≤ 1 day old). Anomalous observations are excluded.
- **Unavailable** when either input is unavailable. No partial scores.
- **Eligibility:** current members ≥ 1,000.
- **Status:** the weights and eligibility were approved as **D-019** (2026-09-30). It's labelled as a calculated signal, not an official Telegram ranking.
