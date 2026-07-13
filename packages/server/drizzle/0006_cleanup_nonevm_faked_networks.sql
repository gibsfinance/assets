-- Delete faked non-Ethereum-Virtual-Machine networks and their data.
--
-- Before the Increment 2a/3 collector fixes, insertNetworkFromChainId normalized a
-- bare coin number into "eip155-<n>", so Solana / Tron tokens were filed under
-- fabricated Ethereum-Virtual-Machine chain ids. The collectors now write the correct
-- coin-type ids (solana-501, tvm-195), leaving those old rows as stale duplicates that
-- still carry an image_hash pointing at an image no longer present -- so the /networks
-- feed lists them and the UI requests /image/eip155-900, which 404s (a broken icon).
--
-- This is the manual scripts/cleanup-nonevm-faked-networks.sql promoted into the
-- auto-applied migration chain, now that live staging has confirmed the re-homing
-- (solana-501 / tvm-195 / ton-607 all serve real icons) and the phantom ids only 404.
-- The one change from the manual script: the "has at least one token" guard is dropped
-- so token-less husks are swept too (see the predicate note below). scripts/README.md and
-- the preview/cleanup scripts were updated to match. See it for the excluded-chains reasoning.
--
-- SCOPE: an explicit allow-list of the four reviewed faked Solana/Tron networks:
--   eip155-900        Solana (base58 mints)      -> re-homed to solana-501
--   eip155-501000101  Solana (base58 mints)      -> re-homed to solana-501
--   eip155-1000       Tron (numeric TRC-10 ids)  -> re-homed to tvm-195
--   eip155-728126428  Tron (duplicate of 1000)   -> re-homed to tvm-195
-- Ontology (eip155-58, a REAL eip155 chain), Algorand (eip155-4160), and BRC-20/Runes
-- (eip155-2203) are deliberately NOT in the list -- see scripts/README.md.
--
-- SAFETY: even within the allow-list, a row is deleted only if NONE of its tokens look
-- like a 0x + 40 hex address, so a genuine Ethereum-Virtual-Machine chain that reused one
-- of these numeric ids (it always has hex tokens) is protected. Token-less husks are
-- deleted too -- they carry a dangling image_hash and no data. Idempotent: once the
-- allow-listed rows are gone the predicate matches nothing, so re-running is a no-op.

-- Materialize the target set once. A plain CTE scopes to a single statement, but the
-- cleanup spans two DELETEs (list_order_item, then network), so a temp table is used --
-- mirroring migration 0005. Predicate matches an allow-listed id as long as it has NO
-- Ethereum-Virtual-Machine token (0x + 40 hex). Note there is deliberately NO
-- "has at least one token" guard here: after the collectors re-homed their tokens, three
-- of these ids (eip155-900, eip155-1000, eip155-728126428) are now token-LESS husks --
-- a bare network row that still advertises an image_hash. eip155-900's hash is orphaned
-- (no matching image row), so /image/eip155-900 404s (a broken icon in the UI). A husk
-- has zero tokens, so the hex guard is vacuously true for it; requiring a token would
-- leave these husks (and their dangling images) behind, which is the whole bug. The hex
-- guard alone still protects a real Ethereum chain that reused one of these numeric ids:
-- it always has hex tokens and is therefore never selected.
CREATE TEMPORARY TABLE _faked_networks AS
SELECT n.network_id, n.chain_id, n.type
FROM network n
WHERE n.chain_id IN ('eip155-900', 'eip155-501000101', 'eip155-1000', 'eip155-728126428')
  AND NOT EXISTS (
    SELECT 1 FROM token t
    WHERE t.network_id = n.network_id
      AND t.provided_id::text ~* '^0x[0-9a-f]{40}$'
  );--> statement-breakpoint

-- 1. Clear the only foreign key into the affected rows that is NOT ON DELETE CASCADE:
--    list_order_item.list_id -> list. Without this, deleting the network would fail the
--    restrict check for any faked list that sync-order happened to rank. sync-order
--    rebuilds list_order_item on its next run.
DELETE FROM list_order_item
WHERE list_id IN (
  SELECT l.list_id
  FROM list l
  JOIN _faked_networks f ON f.network_id = l.network_id
);--> statement-breakpoint

-- 2. Delete the faked network rows. ON DELETE CASCADE removes their token, list, bridge,
--    and metadata rows, which cascade further to list_token, list_tag, bridge_link,
--    header_link, and metadata. Only the correct-namespace rows (solana-501, tvm-195)
--    survive.
DELETE FROM network
WHERE network_id IN (SELECT network_id FROM _faked_networks);--> statement-breakpoint

DROP TABLE _faked_networks;
