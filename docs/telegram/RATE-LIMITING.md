# Rate Limiting

Dimensions can include global, account/session, method, channel and job priority.

On rate-limit signals: classify -> persist state -> backoff -> reschedule. Prevent synchronized retry storms. Never defeat provider limits.
