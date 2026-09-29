# PostgreSQL Design

Core tables:
users, user_sessions, organizations, organization_members, roles, permissions, role_permissions,
channels, channel_aliases, categories, channel_categories, posts, post_media, tracked_channels,
alerts, alert_events, api_keys, api_usage, plans, subscriptions, subscription_events, payments,
invoices, coupons, entitlements, bot_users, jobs, job_attempts, dead_letter_jobs, audit_logs,
system_settings, feature_flags.

Rules: foreign keys; unique/check constraints; transactions; query-backed indexes; cursor pagination for large datasets.
