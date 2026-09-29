# Metric Contract

Every metric defines source, observation time, calculation, window, missing-data behavior, freshness, display label and raw/calculated status.

Examples:
absolute_growth = current - previous_valid
percentage_growth = (current - previous_valid) / previous_valid * 100 when previous_valid != 0

Unavailable metrics remain unavailable; never invent values.
