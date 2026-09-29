-- Runs once on first start of the local PostgreSQL container.
-- tga_test: integration tests (wiped by the test harness). tga_shadow: Prisma shadow database.
CREATE DATABASE tga_test;
CREATE DATABASE tga_shadow;
