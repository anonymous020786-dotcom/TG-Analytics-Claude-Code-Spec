-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "lease_expires_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "leases" (
    "key" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leases_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "leases_expires_at_idx" ON "leases"("expires_at");

-- CreateIndex
CREATE INDEX "jobs_status_lease_expires_at_idx" ON "jobs"("status", "lease_expires_at");

-- Hand-written constraints (ADR-010).
ALTER TABLE "leases"
  ADD CONSTRAINT "leases_key_format_check" CHECK (length("key") BETWEEN 1 AND 200),
  ADD CONSTRAINT "leases_owner_check" CHECK (length("owner") BETWEEN 1 AND 200);
