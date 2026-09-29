# workers/search

Search indexing (`@tga/worker-search`, ADR-015): consumes `search.index`, builds the channel's search document (current username, previous usernames, title, description) and upserts it into the search index, or removes it when the channel is hidden, not active or has no public username. Idempotent: an older source version never overwrites a newer document. Never calls Telegram.

Run: `pnpm --filter @tga/worker-search build && pnpm --filter @tga/worker-search start:local`
