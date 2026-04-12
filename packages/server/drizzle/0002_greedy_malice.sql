DROP INDEX IF EXISTS "network_chainid_index";--> statement-breakpoint
ALTER TABLE "network" ALTER COLUMN "chain_id" SET DATA TYPE text;--> statement-breakpoint
UPDATE "network" SET "chain_id" = 'asset-0' WHERE "chain_id" = '0';--> statement-breakpoint
UPDATE "network" SET "chain_id" = 'eip155-' || "chain_id" WHERE "chain_id" NOT LIKE '%-%';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_chainid_index" ON "network" USING btree ("chain_id" text_ops);