# Rankings

Every ranking declares metric, observation window, eligible population, freshness rule, tie-break rule and methodology version.

## Definitions (PHASE-11, ADR-013)

| Key | Metric | Window | Eligible population | Freshness rule | Tie-break | Version |
|---|---|---|---|---|---|---|
| `top-subscribers` | `members` | — | Active, visible channels/groups with a current value | Current value ≤ 1 day old | Score desc, then channel id asc | `rank-members-v1` |
| `fastest-growing-7d` | `members_growth_7d` (absolute) | 7 d | As above, with current members ≥ 1,000 and a 7-day baseline | As above | Same | `rank-growth7d-v1` |
| `trending` | `trending_score` (TRENDING.md) | 1 d + 7 d | As above, with both baselines | As above | Same | `trending-v1` |

- Runs are immutable and stored per `asOf` window. At most 1,000 entries are kept per run.
- Every ranking shows the disclaimer "Calculated by TG Analytics from public data; not an official Telegram ranking."
- The eligibility base, freshness window and entry limit are proposals pending **OD-015**. Changing any of them creates a new version.
