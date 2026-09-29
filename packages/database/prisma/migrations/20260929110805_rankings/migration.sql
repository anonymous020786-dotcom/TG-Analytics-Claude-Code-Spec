-- CreateTable
CREATE TABLE "ranking_runs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ranking_key" TEXT NOT NULL,
    "methodology_version" TEXT NOT NULL,
    "as_of" TIMESTAMPTZ(6) NOT NULL,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eligible_count" INTEGER NOT NULL,
    "entry_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranking_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranking_snapshots" (
    "run_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "channel_id" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranking_snapshots_pkey" PRIMARY KEY ("run_id","position")
);

-- CreateIndex
CREATE INDEX "ranking_runs_ranking_key_as_of_idx" ON "ranking_runs"("ranking_key", "as_of" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ranking_runs_ranking_key_methodology_version_as_of_key" ON "ranking_runs"("ranking_key", "methodology_version", "as_of");

-- CreateIndex
CREATE INDEX "ranking_snapshots_channel_id_idx" ON "ranking_snapshots"("channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "ranking_snapshots_run_id_channel_id_key" ON "ranking_snapshots"("run_id", "channel_id");

-- AddForeignKey
ALTER TABLE "ranking_snapshots" ADD CONSTRAINT "ranking_snapshots_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ranking_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_snapshots" ADD CONSTRAINT "ranking_snapshots_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written constraints and immutability (ADR-010, ADR-013).
ALTER TABLE "ranking_runs"
  ADD CONSTRAINT "ranking_runs_key_check" CHECK ("ranking_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("ranking_key") <= 64),
  ADD CONSTRAINT "ranking_runs_version_check" CHECK (length("methodology_version") BETWEEN 1 AND 64),
  ADD CONSTRAINT "ranking_runs_counts_check" CHECK ("eligible_count" >= 0 AND "entry_count" >= 0 AND "entry_count" <= "eligible_count");

ALTER TABLE "ranking_snapshots"
  ADD CONSTRAINT "ranking_snapshots_position_check" CHECK ("position" >= 1),
  ADD CONSTRAINT "ranking_snapshots_score_check" CHECK ("score" = "score" AND "score" NOT IN ('Infinity', '-Infinity'));

CREATE FUNCTION "rankings_block_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable (UPDATE blocked)', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "ranking_runs_no_update" BEFORE UPDATE ON "ranking_runs" FOR EACH ROW EXECUTE FUNCTION "rankings_block_update"();
CREATE TRIGGER "ranking_snapshots_no_update" BEFORE UPDATE ON "ranking_snapshots" FOR EACH ROW EXECUTE FUNCTION "rankings_block_update"();
