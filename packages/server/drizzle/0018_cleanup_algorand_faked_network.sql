-- Delete the stale faked Algorand network eip155-4160 and its data.
--
-- Older collectors normalized Algorand's bare coin number into "eip155-4160", filing it
-- under the Ethereum-Virtual-Machine namespace although Algorand is not
-- Ethereum-Virtual-Machine-compatible. Algorand now has a proper home, algorand-283,
-- which is populated and serves its own icon on staging and production. Migration 0006
-- deliberately kept eip155-4160 until that happened; this migration finishes the job.
--
-- SCOPE: exactly one id, eip155-4160. Ontology (eip155-58, a REAL eip155 chain) and
-- BRC-20/Runes (eip155-2203) stay out -- see scripts/README.md.
--
-- SAFETY: identical to migration 0006. The row is deleted only if NONE of its tokens look
-- like a 0x + 40 hex address, so a genuine Ethereum-Virtual-Machine chain that reuses the
-- number 4160 (it always has hex tokens) is protected. A token-less husk has no hex tokens,
-- so the guard is vacuously true and the husk is swept too. Idempotent: once the row is
-- gone the predicate matches nothing, so re-running is a no-op.

CREATE TEMPORARY TABLE _faked_networks AS
SELECT n.network_id, n.chain_id, n.type
FROM network n
WHERE n.chain_id IN ('eip155-4160')
  AND NOT EXISTS (
    SELECT 1 FROM token t
    WHERE t.network_id = n.network_id
      AND t.provided_id::text ~* '^0x[0-9a-f]{40}$'
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
