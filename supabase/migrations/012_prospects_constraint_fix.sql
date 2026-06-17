-- Migration 012: Fix prospect upsert constraint
-- Replace partial unique index with a regular UNIQUE constraint.
-- ON CONFLICT requires a standard constraint, not a partial index.
-- PostgreSQL NULLs are DISTINCT by default, so multiple null-CIK
-- rows (manual prospects) are still allowed.

DROP INDEX IF EXISTS prospects_cik_source_unique;

ALTER TABLE public.prospects
  ADD CONSTRAINT prospects_cik_source_key UNIQUE (cik, source);
