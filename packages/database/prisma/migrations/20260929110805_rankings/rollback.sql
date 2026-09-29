-- Rollback for rankings. DESTRUCTIVE: drops all computed rankings (recomputable from snapshots).
DROP TABLE IF EXISTS "ranking_snapshots", "ranking_runs";
DROP FUNCTION IF EXISTS "rankings_block_update"();
DELETE FROM "_prisma_migrations" WHERE "migration_name" LIKE '%_rankings';
