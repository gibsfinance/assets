-- Separates "a list version has been written" from "a list version may be read".
--
-- `list_id` is a hash of (provider_id, key, major, minor, patch), so when a remote list
-- bumps its version, discover() inserts a brand-new row holding zero tokens rather than
-- updating the populated one beside it. collect() then fills that row in one token at a
-- time, each in its own transaction, each containing a live image fetch.
--
-- The newest-version filter previously treated a newer version as authoritative as soon
-- as it held a single token. That is the whole bug: from the moment token one lands until
-- the moment the last one does, the new version wins outright and every token it has not
-- rewritten yet is simply absent from responses. It is not brief. The early-return in
-- fetchImageAndStoreForToken that normally skips the network is gated on finding an
-- existing list_token for that list_id, and on a fresh version there are none, so every
-- token takes the full path including a fetch with a three-second timeout. A ten thousand
-- token list spends tens of minutes there, and hours if the provider's image host is slow.
--
-- So the filter now asks for a publish marker instead of a token count. collect() sets
-- tokens_collected_at in a single-row update after it has walked the entire list, and
-- until it does, readers keep seeing the last version that carries one. The rows behind
-- the marker are still written piecemeal — what became atomic is the switchover, which is
-- where the harm actually was.
--
-- The backfill below is chosen to make this migration a no-op at deploy rather than a
-- behaviour change. Marking exactly those lists that already hold at least one list_token
-- reproduces the old predicate row for row; the filter only starts to bite as later
-- collection runs create versions that have not finished yet. A list left null here has
-- no tokens at all, which is precisely the case the old predicate also excluded.
--
-- updated_at is used as the timestamp rather than now(): these versions finished
-- collecting at some point in the past and dating them to the migration would misreport
-- every existing list as having been collected the moment this deployed.
ALTER TABLE "list" ADD COLUMN IF NOT EXISTS "tokens_collected_at" timestamp with time zone;--> statement-breakpoint

UPDATE "list"
SET "tokens_collected_at" = "list"."updated_at"
WHERE "tokens_collected_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "list_token" WHERE "list_token"."list_id" = "list"."list_id"
  );
