-- Delete networks whose stored type contradicts their chain-id namespace.
--
-- insertNetworkFromChainId normalizes a bare numeric id to eip155-<n>, so an
-- eip155-* network must carry type 'evm'. A handful of legacy rows violate this:
--
--   eip155-1651794797  type 'btc'  -- the smoldapp collector hashed its "btcm"
--                                     chain folder (stringToHex('btcm') = 0x6274636d
--                                     = 1651794797) and typed everything
--                                     non-numeric 'btc', writing a fake Ethereum id.
--   eip155-1           type 'tvm'  -- a legacy Tron/TON mis-file colliding with
--                                     real Ethereum mainnet's id (a distinct
--                                     network_id, so real mainnet is untouched).
--
-- The UI renders these as bogus networks in the select-network drawer: a second
-- "Ethereum" row showing raw "eip155-1", and a "Chain 1651794797". The collector
-- source is fixed in the same change (smoldapp skips non-numeric folders, and
-- insertNetworkFromChainId now throws on a type/namespace mismatch), so this
-- cleanup is a one-time sweep of the rows written before that guard existed.
--
-- SCOPE: self-validating -- every eip155-* row whose type is not 'evm'. Because
-- real Ethereum-Virtual-Machine chains are always type 'evm', this can never
-- select a legitimate network; the predicate is the safety. Idempotent: once the
-- corrupt rows are gone nothing matches, so re-running is a no-op.

-- Materialize the target set once. A plain CTE scopes to a single statement, but
-- the cleanup spans two DELETEs (list_order_item, then network), so a temp table
-- is used -- mirroring migrations 0005 and 0006.
CREATE TEMPORARY TABLE _type_mismatched_networks AS
SELECT n.network_id, n.chain_id, n.type
FROM network n
WHERE n.chain_id LIKE 'eip155-%'
  AND n.type <> 'evm';--> statement-breakpoint

-- 1. Clear the only foreign key into the affected rows that is NOT ON DELETE
--    CASCADE: list_order_item.list_id -> list. Without this, deleting the network
--    would fail the restrict check for any list sync-order happened to rank.
--    sync-order rebuilds list_order_item on its next run.
DELETE FROM list_order_item
WHERE list_id IN (
  SELECT l.list_id
  FROM list l
  JOIN _type_mismatched_networks m ON m.network_id = l.network_id
);--> statement-breakpoint

-- 2. Delete the corrupt network rows. ON DELETE CASCADE removes their token,
--    list, bridge, and metadata rows, which cascade further to list_token,
--    list_tag, bridge_link, header_link, and metadata.
DELETE FROM network
WHERE network_id IN (SELECT network_id FROM _type_mismatched_networks);--> statement-breakpoint

DROP TABLE _type_mismatched_networks;
