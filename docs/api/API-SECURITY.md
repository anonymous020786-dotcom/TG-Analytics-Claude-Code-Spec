# API Security

API key fields: id, owner_id, prefix, secret_hash, permissions, rate_limit, quota, last_used_at, expires_at, revoked_at.

Never store raw secrets. Enforce scopes and quotas server-side.
