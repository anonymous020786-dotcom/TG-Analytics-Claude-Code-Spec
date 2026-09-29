# Queue Architecture

Queues:
channel.discovery
channel.metadata
channel.posts
channel.metrics
analytics.process
search.index
notifications.evaluate
exports.generate

Job fields: job_id, type, entity_id, payload_version, priority, attempt, scheduled_at, idempotency_key, trace_id.

Failure classes: transient, rate_limited, authorization, invalid_input, dependency_down, permanent, unknown.

Use bounded exponential backoff and a dead-letter queue. Every side-effecting job needs an idempotency key.
