-- Phase one of moving image bytes out of Postgres: describe each image's bytes by digest and
-- length, so they can live in the image store (packages/server/src/image-store) instead.
--
-- Safe while the previous release is still serving. Each statement is either a change to the
-- catalog only (ADD COLUMN without a default, DROP NOT NULL) or an index over a column that
-- is entirely NULL today, and the previous release neither reads nor writes the new columns.
-- Its own inserts keep writing `content`, and leave `byte_size` NULL, which is exactly what
-- `images export` selects on. Every statement is guarded, so a second run changes nothing.
--
-- content_sha256 is sha256 of the stored bytes and names the file in the store. It is not
-- unique: the same picture under two addresses is two rows and one file.
--
-- One guard for the overlap with the previous release. Its upsert replaces `content` and knows
-- nothing of the digest, so on a row that was already exported the digest would go on naming
-- the old bytes. The trigger hashes the bytes being written, and when they do not match the
-- digest on the row it clears the digest and length, which marks the row as not exported;
-- `images export` then picks it up again. This release's own writes always match (or write
-- NULL bytes), so the check passes them untouched, and it costs nothing on a statement that
-- leaves `content` alone.
--
-- Written by hand (drizzle-kit does not emit IF NOT EXISTS); the snapshot is what it generated.
ALTER TABLE "image" ADD COLUMN IF NOT EXISTS "content_sha256" text;--> statement-breakpoint
ALTER TABLE "image" ADD COLUMN IF NOT EXISTS "byte_size" integer;--> statement-breakpoint
ALTER TABLE "image" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_content_sha256_index" ON "image" USING btree ("content_sha256" text_ops);--> statement-breakpoint
CREATE OR REPLACE FUNCTION image_clear_stale_digest() RETURNS trigger AS $$
BEGIN
  IF NEW.content IS NOT NULL
     AND NEW.content_sha256 IS NOT NULL
     AND encode(sha256(NEW.content), 'hex') <> NEW.content_sha256 THEN
    NEW.content_sha256 := NULL;
    NEW.byte_size := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS image_clear_stale_digest ON "image";--> statement-breakpoint
CREATE TRIGGER image_clear_stale_digest
  BEFORE UPDATE OF content ON "image"
  FOR EACH ROW EXECUTE FUNCTION image_clear_stale_digest();
