DROP INDEX IF EXISTS "network_chainid_index";--> statement-breakpoint
-- Must drop the trigger before altering column type (PG constraint)
DROP TRIGGER IF EXISTS set_composite_id_network ON "network";--> statement-breakpoint
ALTER TABLE "network" ALTER COLUMN "chain_id" SET DATA TYPE text;--> statement-breakpoint
UPDATE "network" SET "chain_id" = 'asset-0' WHERE "chain_id" = '0';--> statement-breakpoint
UPDATE "network" SET "chain_id" = 'eip155-' || "chain_id" WHERE "chain_id" NOT LIKE '%-%';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_chainid_index" ON "network" USING btree ("chain_id" text_ops);--> statement-breakpoint
-- Trigger still hashes type + bare reference (extracted from CAIP-2)
-- to keep network_id consistent with existing data. No rekey needed.
CREATE OR REPLACE FUNCTION gcid_network_network_id_type_chainid()
RETURNS TRIGGER AS $$
BEGIN
    NEW.network_id := keccak256(NEW.type::text || SPLIT_PART(NEW.chain_id, '-', 2)::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- Recreate the trigger
CREATE TRIGGER set_composite_id_network
    BEFORE INSERT OR UPDATE ON "network"
    FOR EACH ROW
    EXECUTE FUNCTION gcid_network_network_id_type_chainid();