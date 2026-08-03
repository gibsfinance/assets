-- Trigram indexes behind GET /list/search.
--
-- The search predicate is `name ILIKE '%term%' OR symbol ILIKE '%term%'`, and a leading
-- wildcard defeats every btree index on the table: the existing `token_name_index` and
-- `token_symbol_index` can answer a prefix but not a substring, so the planner falls back
-- to a sequential scan of the whole token table on every distinct query. Measured against
-- a local copy holding 76,486 tokens, the search query ran in roughly 130ms warm, of which
-- the scan was the bulk; with the indexes below it runs in 18ms. The gap widens with the
-- table, because a trigram lookup is driven by the number of matches rather than by the
-- number of rows, while the scan is driven by the rows.
--
-- Both statements are wrapped rather than issued directly, for two different reasons.
--
-- CREATE EXTENSION is wrapped as insurance rather than because it is expected to fail.
-- pg_trgm is a *trusted* extension, so from PostgreSQL 13 onward any database owner may
-- install it without being a superuser — verified here against a deliberately
-- unprivileged role, which installed it fine. What the guard covers is a managed provider
-- that restricts extensions further than the server does. In that case the migration must
-- still succeed: the endpoint is correct either way and only slower, and a deploy that
-- refuses to start over a performance index is a far worse outcome than a slow search.
-- The handler neither tests for these indexes nor changes behaviour based on them.
--
-- The index creation is then guarded on the extension actually being present, because
-- `gin_trgm_ops` is an operator class the extension defines: without it the statement is a
-- syntax-level failure rather than something IF NOT EXISTS can absorb.
--
-- Not created CONCURRENTLY: CREATE INDEX CONCURRENTLY cannot run inside a transaction
-- block, and the migration runner wraps each file in one. The lock is a write lock on
-- `token` for the duration of the build — a few seconds at this table size, taken during a
-- deploy, against a table written only by the collectors.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION
  WHEN insufficient_privilege OR undefined_file THEN
    RAISE NOTICE 'pg_trgm unavailable (%). Token search will fall back to a sequential scan.', SQLERRM;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "token_name_trgm_index" ON "token" USING gin ("name" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "token_symbol_trgm_index" ON "token" USING gin ("symbol" gin_trgm_ops);
  END IF;
END
$$;
