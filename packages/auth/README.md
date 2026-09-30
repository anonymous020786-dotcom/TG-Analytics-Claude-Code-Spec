# packages/auth

Authentication primitives (`@tga/auth`, PHASE-16, ADR-017, D-021): verification of Sign in with Telegram payloads (Telegram Login Widget HMAC and freshness), opaque session tokens (only SHA-256 hashes are stored) and session-bound CSRF tokens. Node's built-in `crypto` only; no third-party dependencies. No passwords are handled anywhere.
