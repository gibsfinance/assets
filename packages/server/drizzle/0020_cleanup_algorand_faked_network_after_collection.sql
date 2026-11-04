-- Re-run of 0018's guarded delete of the stale Algorand network eip155-4160.
--
-- 0018 ran once, at deploy, when algorand-283 held none of the three Algorand assets
-- that eip155-4160 carried, so its guard kept the network (by design). The first
-- collection with the fixed Trust Wallet collector has since filed HDL (137594422),
-- USDT (312769) and USDC (31566704) under algorand-283 (checked on gib.show,
-- 2026-11-04), so the same guard now lets the delete through. Migrations run once
-- each, which is why this is a new number rather than a re-run of 0018.
--
-- The guard is unchanged: a network is deleted only when none of its tokens looks
-- like an EVM address and every one of its tokens already exists under algorand-283.
-- If that is not yet true where this runs, it deletes nothing.
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

DELETE FROM list_order_item
WHERE list_id IN (
  SELECT l.list_id
  FROM list l
  JOIN _faked_networks f ON f.network_id = l.network_id
);--> statement-breakpoint

DELETE FROM network
WHERE network_id IN (SELECT network_id FROM _faked_networks);--> statement-breakpoint

DROP TABLE _faked_networks;
