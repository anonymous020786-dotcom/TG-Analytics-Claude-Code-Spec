-- Fix: PostgreSQL treats NaN = NaN as true, so "score = score" did not exclude NaN.
-- ranking_snapshots holds no NaN rows (inserts were validated at the application level
-- before this change), so the constraint can be added VALID directly.
ALTER TABLE "ranking_snapshots" DROP CONSTRAINT "ranking_snapshots_score_check";
ALTER TABLE "ranking_snapshots"
  ADD CONSTRAINT "ranking_snapshots_score_check" CHECK ("score" NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8));
