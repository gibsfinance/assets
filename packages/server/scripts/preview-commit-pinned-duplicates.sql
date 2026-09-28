-- Preview: commit-pinned duplicate images from vendored artwork. Reads only.
--
-- For about a week (commit 3b7abe3d ended it) the three vendored collectors -
-- trustwallet, smoldapp, pls369 - recorded each image at the repository's
-- checked-out COMMIT. An image's identity hashes its bytes with its recorded
-- address, so every upstream commit gave every file a new identity and a new
-- stored copy, whether the file had changed or not. The collectors now record
-- the default branch, which is stable, so no new copies are made. The copies
-- already made remain; cleanup-commit-pinned-duplicates.sql removes them.
--
-- A copy is a candidate only when BOTH hold:
--   * its address is on one of the three repositories AND pinned to a 40
--     character commit (branch addresses - master, main - are never touched);
--   * nothing references it: no list entry, network, list, or header link.
--
-- The second condition is not a courtesy. list.image_hash and
-- header_link.image_hash are declared ON DELETE CASCADE, so deleting an image a
-- list still points at would silently delete THE LIST. Anything referenced is
-- left alone; it becomes deletable once the next collection moves its
-- references onto the branch copy, and a re-run of the cleanup picks it up.
--
-- link and image_variant rows are derived from the image (its address record
-- and its cached resizes), so they go with it.
--
--   psql "$DATABASE_URL" -X -f preview-commit-pinned-duplicates.sql

\pset border 1

with pinned as (
  select image_hash, length(content) as bytes,
         split_part(uri, '/', 4) || '/' || split_part(uri, '/', 5) as repository
  from image
  where (uri like 'https://raw.githubusercontent.com/trustwallet/assets/%'
      or uri like 'https://raw.githubusercontent.com/SmolDapp/tokenAssets/%'
      or uri like 'https://raw.githubusercontent.com/PLS369/pulsechain-assets/%')
    and split_part(uri, '/', 6) ~ '^[0-9a-f]{40}$'
),
classified as (
  select pinned.*,
         exists (select 1 from list_token t where t.image_hash = pinned.image_hash)
      or exists (select 1 from network n where n.image_hash = pinned.image_hash)
      or exists (select 1 from list l where l.image_hash = pinned.image_hash)
      or exists (select 1 from header_link h where h.image_hash = pinned.image_hash) as referenced
  from pinned
)
select repository,
       count(*) as commit_pinned_copies,
       count(*) filter (where referenced) as still_referenced_kept,
       count(*) filter (where not referenced) as to_delete,
       pg_size_pretty(coalesce(sum(bytes) filter (where not referenced), 0)) as reclaimable
from classified
group by repository
order by to_delete desc;
