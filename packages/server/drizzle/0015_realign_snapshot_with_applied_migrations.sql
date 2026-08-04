-- Carries a corrected drizzle snapshot. Every statement below is already applied.
--
-- Migrations 0011-0014 were hand-written and none regenerated a meta snapshot, so
-- drizzle-kit's model of the database stayed frozen at 0010. Any `generate` therefore
-- re-emitted work that 0012, 0013 and 0014 had already done: dropping the twenty
-- redundant indexes 0013 removed, and adding the two columns 0012 and 0014 added.
-- That replay would have failed on any real database, and the only thing standing
-- between it and production was someone reading the generated file before committing it.
--
-- The migration runner (drizzle-orm/node-postgres/migrator) reads only _journal.json and
-- these .sql files; it never opens meta/. So the snapshot is developer-facing state and
-- correcting it cannot change what any database applies. This file exists purely to carry
-- meta/0015_snapshot.json, which finally matches schema.ts.
--
-- Every statement is guarded, making this a no-op in both directions: on an existing
-- database the indexes are long gone and the columns already present, and on a fresh one
-- 0013 has just dropped the indexes and 0012/0014 have just added the columns. Verified
-- against a clean database migrated through 0014 -- `drizzle-kit push` reports
-- "No changes detected" against schema.ts.

DROP INDEX IF EXISTS "bridge_bridgeid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "bridge_link_bridgelinkid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "cache_request_key_index";--> statement-breakpoint
DROP INDEX IF EXISTS "header_link_listtokenid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "image_imagehash_index";--> statement-breakpoint
DROP INDEX IF EXISTS "link_uri_index";--> statement-breakpoint
DROP INDEX IF EXISTS "list_listid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "list_order_listorderid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "list_order_item_listorderid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "list_submission_provider_key_index";--> statement-breakpoint
DROP INDEX IF EXISTS "list_submission_url_index";--> statement-breakpoint
DROP INDEX IF EXISTS "list_token_listtokenid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "list_token_tokenid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "metadata_metadataid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "network_networkid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "provider_key_index";--> statement-breakpoint
DROP INDEX IF EXISTS "provider_providerid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "tag_providerid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "token_networkid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "token_tokenid_index";--> statement-breakpoint
ALTER TABLE "list" ADD COLUMN IF NOT EXISTS "tokens_collected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "network" ADD COLUMN IF NOT EXISTS "image_provider_key" text;