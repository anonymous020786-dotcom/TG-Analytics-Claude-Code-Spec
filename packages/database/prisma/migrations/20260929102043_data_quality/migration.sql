-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "last_collection_error_class" TEXT;

-- CreateTable
CREATE TABLE "metric_anomalies" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "channel_id" UUID NOT NULL,
    "metric" TEXT NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "rule" TEXT NOT NULL,
    "previous_value" BIGINT NOT NULL,
    "value" BIGINT NOT NULL,
    "relative_change" DOUBLE PRECISION NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "metric_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "metric_anomalies_detected_at_idx" ON "metric_anomalies"("detected_at");

-- CreateIndex
CREATE UNIQUE INDEX "metric_anomalies_channel_id_metric_observed_at_rule_key" ON "metric_anomalies"("channel_id", "metric", "observed_at", "rule");

-- AddForeignKey
ALTER TABLE "metric_anomalies" ADD CONSTRAINT "metric_anomalies_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written constraints (ADR-010). metric_anomalies is new; channels column is nullable.
ALTER TABLE "channels"
  ADD CONSTRAINT "channels_last_collection_error_class_check" CHECK ("last_collection_error_class" IS NULL OR "last_collection_error_class" IN
    ('transient', 'rate_limited', 'authorization', 'invalid_input', 'dependency_down', 'permanent', 'unknown'));

ALTER TABLE "metric_anomalies"
  ADD CONSTRAINT "metric_anomalies_rule_check" CHECK ("rule" IN ('drop_to_zero', 'large_increase', 'large_decrease')),
  ADD CONSTRAINT "metric_anomalies_values_check" CHECK ("previous_value" >= 0 AND "value" >= 0),
  ADD CONSTRAINT "metric_anomalies_metric_check" CHECK (length("metric") <= 64 AND "metric" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$');
