DROP INDEX IF EXISTS "network_chainid_index";--> statement-breakpoint
ALTER TABLE "network" ALTER COLUMN "chain_id" SET DATA TYPE text;--> statement-breakpoint
UPDATE "network" SET "chain_id" = 'asset-0' WHERE "chain_id" = '0';--> statement-breakpoint
UPDATE "network" SET "chain_id" = 'eip155-' || "chain_id" WHERE "chain_id" NOT LIKE '%-%';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_chainid_index" ON "network" USING btree ("chain_id" text_ops);--> statement-breakpoint
-- Recompute network_id from new CAIP-2 chain_id. ON UPDATE CASCADE
-- propagates to token, list, metadata, bridge, etc.
UPDATE "network" SET "network_id" = keccak256("type"::text || "chain_id"::text);--> statement-breakpoint
-- Update trigger to hash the full CAIP-2 chain_id (not bare number)
CREATE OR REPLACE FUNCTION gcid_network_network_id_type_chainid()
RETURNS TRIGGER AS $$
BEGIN
    NEW.network_id := keccak256(NEW.type::text || NEW.chain_id::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;