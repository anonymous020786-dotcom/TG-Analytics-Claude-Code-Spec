-- Rollback for analytics_snapshots. DESTRUCTIVE: drops all historical snapshots.
-- Requires explicit approval (CLAUDE.md); take a backup first.
DROP TABLE IF EXISTS "channel_metric_snapshots", "post_metric_snapshots";
DROP FUNCTION IF EXISTS "metric_snapshots_block_update"();
DELETE FROM "_prisma_migrations" WHERE "migration_name" LIKE '%_analytics_snapshots';
