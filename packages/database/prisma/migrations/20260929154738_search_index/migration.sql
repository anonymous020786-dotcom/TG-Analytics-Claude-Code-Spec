-- PHASE-12 search index (ADR-015). pg_trgm ships with PostgreSQL contrib and is a trusted
-- extension (PostgreSQL 13+), so the database owner can create it without superuser.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "channel_search_documents" (
    "channel_id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "search_text" TEXT NOT NULL,
    "source_version" TIMESTAMPTZ(6) NOT NULL,
    "indexed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_search_documents_pkey" PRIMARY KEY ("channel_id")
);

-- CreateIndex
CREATE INDEX "channel_search_documents_search_text_idx" ON "channel_search_documents" USING GIN ("search_text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "channels_member_count_id_idx" ON "channels"("member_count" DESC, "id");

-- AddForeignKey
ALTER TABLE "channel_search_documents" ADD CONSTRAINT "channel_search_documents_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written constraints (ADR-010): bounded, normalized text only.
ALTER TABLE "channel_search_documents"
  ADD CONSTRAINT "channel_search_documents_username_check" CHECK ("username" ~ '^[a-z0-9_]{1,64}$'),
  ADD CONSTRAINT "channel_search_documents_aliases_check" CHECK (length("aliases") <= 1024),
  ADD CONSTRAINT "channel_search_documents_title_check" CHECK (length("title") BETWEEN 1 AND 512),
  ADD CONSTRAINT "channel_search_documents_description_check" CHECK (length("description") <= 1024),
  ADD CONSTRAINT "channel_search_documents_search_text_check" CHECK (length("search_text") BETWEEN 1 AND 4096 AND "search_text" = lower("search_text"));
