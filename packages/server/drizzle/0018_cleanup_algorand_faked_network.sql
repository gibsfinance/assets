-- Delete the stale faked Algorand network eip155-4160, but only once its data is safe.
--
-- Older collectors filed Algorand under "eip155-4160" (the number the chain registry lists
-- it under, which the Trust Wallet name matcher picked up) although Algorand is not
-- Ethereum-Virtual-Machine-compatible. Its proper home is algorand-283. Migration 0006
-- deliberately kept eip155-4160 until algorand-283 was populated.
--
-- Unlike 0006, this row is NOT yet a pure duplicate: when this was written, eip155-4160
-- still held real Algorand assets (HEADLINE, Tether USD, USD Coin) and algorand-283 held
-- none, because the Trust Wallet collector had no Algorand redirect. The collector is fixed
-- in the same change, so the next collection run fills algorand-283. This migration is a
-- guarded delete that waits for that:
--
--   * It deletes eip155-4160 only when EVERY token under it already exists, by provided id,
--     under algorand-283. Until the fixed collector has run, the guard matches nothing and
--     the migration changes nothing; a later run of the same statements (for example
--     through scripts/cleanup-nonevm-faked-networks.sql) then finishes the job.
--   * A token-less husk has nothing to lose, so the guard is vacuously true for it.
--
-- A SQL re-home was rejected on purpose. network_id, list_id and token_id are hashes made
-- by database triggers from their parents' keys, so moving a token means recomputing its id
-- and cascading the change through list_token and bridge_link, with image and list rows
-- keyed to the old hashes. The collector rebuilds all of it correctly from source, so the
-- migration does not need to.
--
-- SCOPE: exactly one id, eip155-4160. Ontology (eip155-58, a REAL eip155 chain) and
-- BRC-20/Runes (eip155-2203) stay out -- see scripts/README.md.
--
-- SAFETY, as in 0006: the row is also kept if any of its tokens look like a 0x + 40 hex
-- address, so a genuine Ethereum-Virtual-Machine chain that reuses the number 4160 (it
-- always has hex tokens) is protected. Idempotent: once the row is gone the predicate
-- matches nothing, so re-running is a no-op.

CREATE TEMPORARY TABLE _faked_networks AS
SELECT n.network_id, n.chain_id, n.type
FROM network n
WHERE n.chain_id IN ('eip155-4160')
  AND NOT EXISTS (
    SELECT 1 FROM token t
    WHERE t.network_id = n.network_id
      AND t.provided_id::text ~* '^0x[0-9a-f]{40}$'
  )
  AND NOT EXISTS (
    SELECT 1 FROM token t
    WHERE t.network_id = n.network_id
      AND NOT EXISTS (
        SELECT 1
        FROM token home
        JOIN network hn ON hn.network_id = home.network_id
        WHERE hn.chain_id = 'algorand-283'
          AND home.provided_id = t.provided_id
      )
  );--> statement-breakpoint

-- 1. Clear the only foreign key into the affected rows that is NOT ON DELETE CASCADE:
--    list_order_item.list_id -> list. sync-order rebuilds list_order_item on its next run.
DELETE FROM list_order_item
WHERE list_id IN (
  SELECT l.list_id
  FROM list l
  JOIN _faked_networks f ON f.network_id = l.network_id
);--> statement-breakpoint

-- 2. Delete the faked network row. ON DELETE CASCADE removes its token, list, bridge,
--    and metadata rows, which cascade further to list_token, list_tag, bridge_link,
--    header_link, and metadata. algorand-283 is untouched.
DELETE FROM network
WHERE network_id IN (SELECT network_id FROM _faked_networks);--> statement-breakpoint

DROP TABLE _faked_networks;
