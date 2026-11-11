-- Where each blob of the IPFS image store lives: sha256 of the bytes (the store's name for a blob)
-- to the IPFS content identifier the pinning service returned, plus the length and last-write time
-- that IPFS cannot answer for `stat` and `list`. A new, empty table that nothing reads unless the
-- store is configured as `ipfs`, so it is safe while the previous release is serving.
CREATE TABLE IF NOT EXISTS "image_store_cid" (
	"sha256" text PRIMARY KEY NOT NULL,
	"cid" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"modified_at" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
