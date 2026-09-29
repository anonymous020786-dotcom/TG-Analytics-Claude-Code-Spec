# packages/database

PostgreSQL access (`@tga/database`, ADR-010): Prisma schema and migrations, `createDatabase`, cursor pagination helpers and repositories (`ChannelRepository`, `PostRepository`, `JobRepository`, `AuditLogRepository`, `FeatureFlagRepository`).

This is the only package allowed to import database drivers. Operations guide: `docs/operations/DATABASE.md`.
