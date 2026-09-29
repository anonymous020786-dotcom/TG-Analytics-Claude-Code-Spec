-- Rollback for init_core_schema. DESTRUCTIVE: drops every core table and its data.
-- Only for a fresh environment with no data worth keeping; requires explicit approval (CLAUDE.md).
DROP TABLE IF EXISTS "post_media", "posts", "channel_categories", "categories", "channel_aliases",
  "channels", "dead_letter_jobs", "job_attempts", "jobs", "audit_logs", "system_settings",
  "feature_flags" CASCADE;
DROP FUNCTION IF EXISTS "audit_logs_block_mutation"();
DELETE FROM "_prisma_migrations" WHERE "migration_name" LIKE '%_init_core_schema';
