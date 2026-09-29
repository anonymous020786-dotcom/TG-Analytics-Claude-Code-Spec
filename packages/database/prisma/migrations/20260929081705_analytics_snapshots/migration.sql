-- CreateTable
CREATE TABLE "channel_metric_snapshots" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "channel_id" UUID NOT NULL,
    "metric" TEXT NOT NULL,
    "value" BIGINT NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "source" TEXT NOT NULL,
    "job_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_metric_snapshots" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "post_id" UUID NOT NULL,
    "metric" TEXT NOT NULL,
    "value" BIGINT NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "source" TEXT NOT NULL,
    "job_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_metric_snapshots_channel_id_metric_observed_at_key" ON "channel_metric_snapshots"("channel_id", "metric", "observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "post_metric_snapshots_post_id_metric_observed_at_key" ON "post_metric_snapshots"("post_id", "metric", "observed_at");

-- AddForeignKey
ALTER TABLE "channel_metric_snapshots" ADD CONSTRAINT "channel_metric_snapshots_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_metric_snapshots" ADD CONSTRAINT "post_metric_snapshots_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (ADR-010, ADR-011). New empty tables: added VALID.
-- ---------------------------------------------------------------------------
ALTER TABLE "channel_metric_snapshots"
  ADD CONSTRAINT "channel_metric_snapshots_metric_check" CHECK (length("metric") <= 64 AND "metric" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  ADD CONSTRAINT "channel_metric_snapshots_value_check" CHECK ("value" >= 0),
  ADD CONSTRAINT "channel_metric_snapshots_source_check" CHECK ("source" IN ('bot_api', 'mtproto'));

ALTER TABLE "post_metric_snapshots"
  ADD CONSTRAINT "post_metric_snapshots_metric_check" CHECK (length("metric") <= 64 AND "metric" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  ADD CONSTRAINT "post_metric_snapshots_value_check" CHECK ("value" >= 0),
  ADD CONSTRAINT "post_metric_snapshots_source_check" CHECK ("source" IN ('bot_api', 'mtproto'));

-- Snapshots are never overwritten (CLICKHOUSE.md). DELETE stays possible only for
-- retention/removal policy (OD-004), never as part of collection failures.
CREATE FUNCTION "metric_snapshots_block_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (UPDATE blocked)', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "channel_metric_snapshots_no_update"
  BEFORE UPDATE ON "channel_metric_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "metric_snapshots_block_update"();

CREATE TRIGGER "post_metric_snapshots_no_update"
  BEFORE UPDATE ON "post_metric_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "metric_snapshots_block_update"();
