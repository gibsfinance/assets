-- Delete the faked non-Ethereum-Virtual-Machine networks that upstream token
-- lists keep re-numbering as eip155, and which migration 0006 could not fully
-- remove because its "no hex token" guard spared any that carry hex-shaped ids.
--
--   eip155-900        Solana (DexScreener reference)  -> re-homed to solana-501
--   eip155-1000       Tron (TrustWallet reference)     -> re-homed to tvm-195
--   eip155-501000101  Solana (bridged list reference)  -> re-homed to solana-501
--   eip155-728126428  Tron (native eip155-style id)    -> re-homed to tvm-195
--
-- These are the same four ids migration 0006 targeted, but 0006 spared any with a
-- 0x-40-hex token (eip155-728126428 carries hex-shaped Tron ids), and a later
-- collection cycle re-created the Solana one. Both problems are now closed at the
-- source: insertNetworkFromChainId rejects these references (isFakedEvmReference),
-- so a generic list collector can no longer resurrect them. This migration is the
-- one-time sweep of whatever is present when it runs. Unlike 0006 there is no hex
-- guard: the allow-list itself is the safety — none of the four is a real EVM
-- chain (Solana and Tron are served under solana-501 / tvm-195), so deleting the
-- eip155 duplicates loses no canonical data. Idempotent: once gone, re-running
-- matches nothing.

-- Materialize the target set once (two DELETEs span it), mirroring 0005–0007.
CREATE TEMPORARY TABLE _faked_evm_references AS
SELECT n.network_id, n.chain_id
FROM network n
WHERE n.chain_id IN ('eip155-900', 'eip155-1000', 'eip155-501000101', 'eip155-728126428');--> statement-breakpoint

-- 1. Clear the only foreign key into the affected rows that is NOT ON DELETE
--    CASCADE: list_order_item.list_id -> list. sync-order rebuilds it on its next run.
DELETE FROM list_order_item
WHERE list_id IN (
  SELECT l.list_id
  FROM list l
  JOIN _faked_evm_references f ON f.network_id = l.network_id
);--> statement-breakpoint

-- 2. Delete the faked network rows. ON DELETE CASCADE removes their token, list,
--    bridge, and metadata rows, which cascade further to list_token, list_tag,
--    bridge_link, header_link, and metadata.
DELETE FROM network
WHERE network_id IN (SELECT network_id FROM _faked_evm_references);--> statement-breakpoint

DROP TABLE _faked_evm_references;
