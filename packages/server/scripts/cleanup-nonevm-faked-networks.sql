-- Cleanup: delete faked non-Ethereum-Virtual-Machine networks and their data.
--
-- Removes the stale networks that earlier collector runs filed under fabricated
-- Ethereum-Virtual-Machine chain ids (Solana -> eip155-900, Tron -> eip155-1000,
-- and a "tvm"-typed eip155-1 for The-Open-Network). The collectors now write the
-- correct coin-type ids (solana-501, tvm-195, ton-607), so these rows are stale
-- duplicates. See preview-nonevm-faked-networks.sql for the full background.
--
-- SAFETY: the target predicate is self-validating and cannot touch a real chain --
-- it only matches an eip155-* network whose tokens contain NO Ethereum-Virtual-Machine
-- address (0x + 40 hex). A genuine Ethereum-Virtual-Machine chain always has such
-- tokens and is therefore skipped. The "tvm"-typed eip155-1 (The-Open-Network) is a
-- distinct network_id from real Ethereum mainnet, and only the base58/base64url one
-- matches. Still, this DELETE is irreversible: run preview-nonevm-faked-networks.sql
-- on the same database first and eyeball the rows.
--
-- ORDERING: run AFTER the Increment 2a/3 collectors have been deployed AND a full
-- collection cycle has re-populated the correct-id rows (confirm via the preview's
-- reincarnated_token_count == token_count), so nothing is left without a live copy.
--
-- Idempotent: the predicate matches nothing once the faked rows are gone, so re-running
-- is a no-op. Wrapped in a single transaction. Records the run in _data_migrations for
-- an audit trail.
--
-- Run from packages/server:
--   psql "$DATABASE_URL" -f scripts/cleanup-nonevm-faked-networks.sql

BEGIN;

CREATE TABLE IF NOT EXISTS _data_migrations (
  name       text        PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Materialize the target set once. A plain CTE scopes to a single statement, but the
-- cleanup spans two DELETEs (list_order_item, then network), so a temp table is used --
-- mirroring migration 0005. Predicate is identical to preview-nonevm-faked-networks.sql.
CREATE TEMPORARY TABLE _faked_networks ON COMMIT DROP AS
SELECT n.network_id, n.chain_id, n.type
FROM network n
WHERE n.chain_id LIKE 'eip155-%'
  AND EXISTS (SELECT 1 FROM token t WHERE t.network_id = n.network_id)
  AND NOT EXISTS (
    SELECT 1 FROM token t
    WHERE t.network_id = n.network_id
      AND t.provided_id::text ~* '^0x[0-9a-f]{40}$'
  );

-- 1. Clear the only foreign key into the affected rows that is NOT ON DELETE CASCADE:
--    list_order_item.list_id -> list. Without this, deleting the network would fail the
--    restrict check for any faked list that sync-order happened to rank. sync-order
--    rebuilds list_order_item on its next run.
DELETE FROM list_order_item
WHERE list_id IN (
  SELECT l.list_id
  FROM list l
  JOIN _faked_networks f ON f.network_id = l.network_id
);

-- 2. Delete the faked network rows. ON DELETE CASCADE removes their token, list, bridge,
--    and metadata rows, which cascade further to list_token, list_tag, bridge_link,
--    header_link, and metadata. Only the correct-namespace rows (solana-501, tvm-195,
--    ton-607) survive.
DELETE FROM network
WHERE network_id IN (SELECT network_id FROM _faked_networks);

INSERT INTO _data_migrations (name)
VALUES ('cleanup_nonevm_faked_networks')
ON CONFLICT (name) DO NOTHING;

COMMIT;
