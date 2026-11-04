-- Re-run the guarded delete of the stale faked Algorand network eip155-4160 (see 0018).
--
-- Why it runs again now: 0018 ran on production while algorand-283 was still empty, so its
-- guard (every token under eip155-4160 must already exist under algorand-283) matched
-- nothing and the duplicate stayed. Two things have changed since:
--
--   * algorand-283 now holds all three Algorand assets (HEADLINE 137594422, Tether USD
--     312769, USD Coin 31566704), so the guard is satisfied.
--   * eip155-4160 is no longer needed. Algorand's ARC-25 chain ids 4160 and 416001 are now
--     aliases of algorand-283 in chain-id.ts (CHAIN_ID_ALIASES), so /list/tokens/4160 and
--     /image/4160/312769 keep working after the delete.
--
-- An earlier copy of this statement was reverted because the alias did not exist yet. The
-- SQL is identical to 0018 and keeps its safeguards: nothing is deleted when any token
-- under eip155-4160 looks like a 0x address, or is missing under algorand-283. Idempotent.

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
