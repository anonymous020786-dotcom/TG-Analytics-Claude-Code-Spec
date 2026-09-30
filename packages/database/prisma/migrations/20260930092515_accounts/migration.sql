-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "telegram_user_id" BIGINT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "username" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_user_id_key" ON "users"("telegram_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written constraints (ADR-010, ADR-017).
ALTER TABLE "users"
  ADD CONSTRAINT "users_telegram_user_id_check" CHECK ("telegram_user_id" > 0),
  ADD CONSTRAINT "users_first_name_check" CHECK (length("first_name") BETWEEN 1 AND 256),
  ADD CONSTRAINT "users_last_name_check" CHECK ("last_name" IS NULL OR length("last_name") BETWEEN 1 AND 256),
  ADD CONSTRAINT "users_username_check" CHECK ("username" IS NULL OR "username" ~ '^[a-z0-9_]{1,64}$'),
  ADD CONSTRAINT "users_status_check" CHECK ("status" IN ('active', 'disabled'));

ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_token_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "user_sessions_user_agent_check" CHECK ("user_agent" IS NULL OR length("user_agent") <= 200),
  ADD CONSTRAINT "user_sessions_expiry_check" CHECK ("idle_expires_at" <= "expires_at" AND "created_at" < "expires_at");
