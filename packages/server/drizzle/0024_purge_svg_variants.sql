-- Delete every cached resize of a vector (SVG) image.
--
-- Why: until now an SVG was rasterized at its intrinsic size (about 32 by 32 pixels for most
-- logos) before it was fitted to the requested size, and the fit never enlarges. So a request
-- for `?w=128&h=128&as=webp` stored and served a 32 by 32 picture. Those wrong pictures are
-- in `image_variant` and the server serves a stored variant before it renders one, so fixing
-- the code alone would leave them in place.
--
-- Why it is safe: `image_variant` is a cache. Every row is rebuilt from the source image on
-- the next request, so deleting rows loses nothing. Only variants of vector sources go;
-- variants of raster images were correct. The extensions match SVG_SOURCE_EXTS in
-- `src/server/image/resize.ts` ('.svg' and '.svg+xml', the values `image.ext` stores).
-- Idempotent: a second run finds nothing to delete.
DELETE FROM "image_variant"
WHERE "image_hash" IN (
	SELECT "image_hash" FROM "image" WHERE "ext" IN ('.svg', '.svg+xml')
);
