-- CreateTable
CREATE TABLE "channels" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "telegram_id" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "username" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_scam" BOOLEAN NOT NULL DEFAULT false,
    "member_count" BIGINT,
    "member_count_observed_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'active',
    "collection_status" TEXT NOT NULL DEFAULT 'pending',
    "last_collected_at" TIMESTAMPTZ(6),
    "hidden_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_aliases" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "channel_id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "channel_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_categories" (
    "channel_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "channel_categories_pkey" PRIMARY KEY ("channel_id","category_id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "channel_id" UUID NOT NULL,
    "telegram_message_id" BIGINT NOT NULL,
    "posted_at" TIMESTAMPTZ(6) NOT NULL,
    "edited_at" TIMESTAMPTZ(6),
    "text" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_media" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "post_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "media_type" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "post_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "queue" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entity_id" TEXT,
    "payload_version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "trace_id" TEXT,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "last_error_class" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_attempts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "job_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "outcome" TEXT,
    "error_class" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dead_letter_jobs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "job_id" UUID NOT NULL,
    "error_class" TEXT NOT NULL,
    "error_message" TEXT,
    "dead_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redriven_at" TIMESTAMPTZ(6),
    "redriven_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dead_letter_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "metadata" JSONB,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "channels_telegram_id_key" ON "channels"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "channels_username_key" ON "channels"("username");

-- CreateIndex
CREATE INDEX "channel_aliases_username_idx" ON "channel_aliases"("username");

-- CreateIndex
CREATE UNIQUE INDEX "channel_aliases_channel_id_username_key" ON "channel_aliases"("channel_id", "username");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "channel_categories_category_id_idx" ON "channel_categories"("category_id");

-- CreateIndex
CREATE INDEX "posts_channel_id_posted_at_id_idx" ON "posts"("channel_id", "posted_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "posts_channel_id_telegram_message_id_key" ON "posts"("channel_id", "telegram_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "post_media_post_id_position_key" ON "post_media"("post_id", "position");

-- CreateIndex
CREATE INDEX "jobs_queue_status_scheduled_at_idx" ON "jobs"("queue", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "jobs_entity_id_idx" ON "jobs"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_queue_idempotency_key_key" ON "jobs"("queue", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "job_attempts_job_id_attempt_key" ON "job_attempts"("job_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "dead_letter_jobs_job_id_key" ON "dead_letter_jobs"("job_id");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_type_actor_id_idx" ON "audit_logs"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "channel_aliases" ADD CONSTRAINT "channel_aliases_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_categories" ADD CONSTRAINT "channel_categories_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_categories" ADD CONSTRAINT "channel_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_attempts" ADD CONSTRAINT "job_attempts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dead_letter_jobs" ADD CONSTRAINT "dead_letter_jobs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (not expressible in Prisma schema). Tables are new and
-- empty, so constraints are added VALID directly. ADR-010.
-- ---------------------------------------------------------------------------

-- Catalog
ALTER TABLE "channels"
  ADD CONSTRAINT "channels_type_check" CHECK ("type" IN ('channel', 'group')),
  ADD CONSTRAINT "channels_status_check" CHECK ("status" IN ('active', 'not_public', 'deleted', 'inaccessible')),
  ADD CONSTRAINT "channels_collection_status_check" CHECK ("collection_status" IN ('pending', 'ok', 'failed')),
  ADD CONSTRAINT "channels_telegram_id_check" CHECK ("telegram_id" <> 0),
  ADD CONSTRAINT "channels_username_format_check" CHECK ("username" IS NULL OR "username" ~ '^[a-z0-9_]{1,64}$'),
  ADD CONSTRAINT "channels_title_check" CHECK (length("title") BETWEEN 1 AND 512),
  ADD CONSTRAINT "channels_member_count_check" CHECK ("member_count" IS NULL OR "member_count" >= 0),
  ADD CONSTRAINT "channels_member_count_observed_check" CHECK (("member_count" IS NULL) = ("member_count_observed_at" IS NULL));

ALTER TABLE "channel_aliases"
  ADD CONSTRAINT "channel_aliases_username_format_check" CHECK ("username" ~ '^[a-z0-9_]{1,64}$'),
  ADD CONSTRAINT "channel_aliases_seen_order_check" CHECK ("first_seen_at" <= "last_seen_at");

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "categories_name_check" CHECK (length("name") BETWEEN 1 AND 128);

ALTER TABLE "posts"
  ADD CONSTRAINT "posts_telegram_message_id_check" CHECK ("telegram_message_id" > 0),
  ADD CONSTRAINT "posts_edited_after_posted_check" CHECK ("edited_at" IS NULL OR "edited_at" >= "posted_at");

ALTER TABLE "post_media"
  ADD CONSTRAINT "post_media_position_check" CHECK ("position" >= 0),
  ADD CONSTRAINT "post_media_media_type_check" CHECK (length("media_type") BETWEEN 1 AND 32),
  ADD CONSTRAINT "post_media_size_bytes_check" CHECK ("size_bytes" IS NULL OR "size_bytes" >= 0);

-- Job ledger: retries are always bounded (CLAUDE.md).
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_status_check" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'dead')),
  ADD CONSTRAINT "jobs_payload_version_check" CHECK ("payload_version" >= 1),
  ADD CONSTRAINT "jobs_max_attempts_check" CHECK ("max_attempts" >= 1),
  ADD CONSTRAINT "jobs_attempt_bounds_check" CHECK ("attempt" >= 0 AND "attempt" <= "max_attempts"),
  ADD CONSTRAINT "jobs_idempotency_key_check" CHECK (length("idempotency_key") BETWEEN 1 AND 256),
  ADD CONSTRAINT "jobs_last_error_class_check" CHECK ("last_error_class" IS NULL OR "last_error_class" IN
    ('transient', 'rate_limited', 'authorization', 'invalid_input', 'dependency_down', 'permanent', 'unknown'));

ALTER TABLE "job_attempts"
  ADD CONSTRAINT "job_attempts_attempt_check" CHECK ("attempt" >= 1),
  ADD CONSTRAINT "job_attempts_outcome_check" CHECK ("outcome" IS NULL OR "outcome" IN ('succeeded', 'failed')),
  ADD CONSTRAINT "job_attempts_error_class_check" CHECK ("error_class" IS NULL OR "error_class" IN
    ('transient', 'rate_limited', 'authorization', 'invalid_input', 'dependency_down', 'permanent', 'unknown')),
  ADD CONSTRAINT "job_attempts_error_message_check" CHECK ("error_message" IS NULL OR length("error_message") <= 2000);

ALTER TABLE "dead_letter_jobs"
  ADD CONSTRAINT "dead_letter_jobs_error_class_check" CHECK ("error_class" IN
    ('transient', 'rate_limited', 'authorization', 'invalid_input', 'dependency_down', 'permanent', 'unknown')),
  ADD CONSTRAINT "dead_letter_jobs_error_message_check" CHECK ("error_message" IS NULL OR length("error_message") <= 2000);

-- Administration
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_type_check" CHECK ("actor_type" IN ('system', 'user')),
  ADD CONSTRAINT "audit_logs_action_check" CHECK (length("action") BETWEEN 1 AND 128);

ALTER TABLE "feature_flags"
  ADD CONSTRAINT "feature_flags_key_format_check" CHECK ("key" ~ '^[a-z0-9]+([._-][a-z0-9]+)*$');

ALTER TABLE "system_settings"
  ADD CONSTRAINT "system_settings_key_format_check" CHECK ("key" ~ '^[a-z0-9]+([._-][a-z0-9]+)*$');

-- Audit log is append-only: block UPDATE, DELETE and TRUNCATE for every role.
CREATE FUNCTION "audit_logs_block_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_logs_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_block_mutation"();

CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_logs_block_mutation"();
