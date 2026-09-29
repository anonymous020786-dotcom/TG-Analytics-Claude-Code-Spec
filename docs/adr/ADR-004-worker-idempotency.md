# ADR-004 — Idempotent Workers

Every side-effecting worker job requires durable status and an idempotency key because distributed jobs can execute more than once.
