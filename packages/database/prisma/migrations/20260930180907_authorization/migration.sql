-- CreateTable
CREATE TABLE "roles" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "permissions" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_key" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_key","permission_key")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_key" TEXT NOT NULL,
    "granted_by" TEXT NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_key")
);

-- CreateIndex
CREATE INDEX "role_permissions_permission_key_idx" ON "role_permissions"("permission_key");

-- CreateIndex
CREATE INDEX "user_roles_role_key_idx" ON "user_roles"("role_key");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_key_fkey" FOREIGN KEY ("role_key") REFERENCES "roles"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_key_fkey" FOREIGN KEY ("role_key") REFERENCES "roles"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written constraints (ADR-010, ADR-018).
ALTER TABLE "roles" ADD CONSTRAINT "roles_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]{1,31}$');
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]{1,31}\.[a-z][a-z0-9_]{1,31}$');
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_check" CHECK (length("granted_by") BETWEEN 2 AND 80);

-- Seed: only what PHASE-17 enforces. Later phases add roles and permissions in their own
-- migrations together with the endpoints that check them (e.g. moderation in PHASE-26).
INSERT INTO "roles" ("key", "description") VALUES
  ('admin', 'Administrator: manages roles; further administration arrives with PHASE-26');
INSERT INTO "permissions" ("key", "description") VALUES
  ('roles.manage', 'Grant and revoke roles of any user');
INSERT INTO "role_permissions" ("role_key", "permission_key") VALUES
  ('admin', 'roles.manage');
