-- Cleanup: delete commit-pinned duplicate images from vendored artwork.
--
-- Read preview-commit-pinned-duplicates.sql first - it explains why these
-- copies exist and reports exactly what this will delete. Run it, check the
-- numbers, then run this.
--
-- Deletes only images that are BOTH on one of the three vendored repositories
-- pinned to a 40 character commit AND referenced by nothing - no list entry,
-- network, list, or header link. list and header_link cascade on image delete,
-- so a referenced image would take its list with it; the guard is re-checked
-- inside every batch, not once up front, so a collection running concurrently
-- cannot slip a reference in between the check and the delete. Each image's
-- derived rows - its link record and cached resizes - go with it.
--
-- Each batch is its own statement and commits on its own. An earlier version
-- ran every batch inside one block, which is one statement: it hit the
-- database's statement time limit partway through and rolled back everything,
-- including the batches it had already deleted. Separate statements keep each
-- one short, hold locks only briefly, and keep what has been done if the run is
-- interrupted - a re-run simply carries on.
--
-- Safe to re-run: it deletes whatever is unreferenced at the time and nothing
-- else. Branch addresses (master, main) are never touched.
--
--   psql "$DATABASE_URL" -X -f cleanup-commit-pinned-duplicates.sql

-- One batch. A session-only function, so it leaves nothing behind in the schema.
create function pg_temp.delete_commit_pinned_batch(batch_size integer) returns integer
language sql as $$
  with doomed as (
    select i.image_hash
    from image i
    where (i.uri like 'https://raw.githubusercontent.com/trustwallet/assets/%'
        or i.uri like 'https://raw.githubusercontent.com/SmolDapp/tokenAssets/%'
        or i.uri like 'https://raw.githubusercontent.com/PLS369/pulsechain-assets/%')
      and split_part(i.uri, '/', 6) ~ '^[0-9a-f]{40}$'
      and not exists (select 1 from list_token t where t.image_hash = i.image_hash)
      and not exists (select 1 from network n where n.image_hash = i.image_hash)
      and not exists (select 1 from list l where l.image_hash = i.image_hash)
      and not exists (select 1 from header_link h where h.image_hash = i.image_hash)
    limit batch_size
    for update of i skip locked
  ),
  variants as (
    delete from image_variant v using doomed where v.image_hash = doomed.image_hash
  ),
  links as (
    delete from link k using doomed where k.image_hash = doomed.image_hash
  ),
  images as (
    delete from image i using doomed where i.image_hash = doomed.image_hash returning 1
  )
  select count(*)::integer from images
$$;

-- Enough calls to cover every candidate counted now, each one run as its own
-- statement by \gexec. A call that finds nothing left deletes nothing.
select 'select pg_temp.delete_commit_pinned_batch(2000) as deleted'
from generate_series(1, (
  select count(*) / 2000 + 1
  from image i
  where (i.uri like 'https://raw.githubusercontent.com/trustwallet/assets/%'
      or i.uri like 'https://raw.githubusercontent.com/SmolDapp/tokenAssets/%'
      or i.uri like 'https://raw.githubusercontent.com/PLS369/pulsechain-assets/%')
    and split_part(i.uri, '/', 6) ~ '^[0-9a-f]{40}$'
)::integer)
\gexec
