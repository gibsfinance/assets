-- Cleanup: delete faked non-Ethereum-Virtual-Machine networks and their data.
--
-- Removes the stale networks that earlier collector runs filed under fabricated
-- Ethereum-Virtual-Machine chain ids. The collectors now write the correct
-- coin-type ids (solana-501, tvm-195), so these rows are stale duplicates. See
-- preview-nonevm-faked-networks.sql for the full background.
--
-- SCOPE: an explicit allow-list of the four reviewed faked Solana/Tron networks:
--   eip155-900        Solana (base58 mints)       -> re-homed to solana-501
--   eip155-501000101  Solana (base58 mints)       -> re-homed to solana-501
--   eip155-1000       Tron (numeric TRC-10 ids)   -> re-homed to tvm-195
--   eip155-728126428  Tron (duplicate of 1000)    -> re-homed to tvm-195
-- The earlier broad "any eip155 network with no 0x-hex token" predicate ALSO
-- matched genuinely-unhandled chains that were never faked Solana/Tron duplicates
-- and have NO re-homed copy -- BRC-20/Runes (eip155-2203), Algorand (eip155-4160),
-- and Ontology (eip155-58). Deleting those would be data loss, so they are
-- deliberately excluded here; they need their own coin-type namespaces (future
-- work), not deletion.
--
-- SAFETY: even within the allow-list, the no-Ethereum-Virtual-Machine-address guard
-- is kept -- a row is deleted only if it has tokens and NONE look like a 0x + 40 hex
-- address. A real Ethereum-Virtual-Machine chain that happened to reuse one of these
-- numeric ids (e.g. some tooling assigns Tron the eip155-728126428 id) always has hex
-- tokens and is therefore skipped. This DELETE is irreversible: run
-- preview-nonevm-faked-networks.sql on the same database first and eyeball the rows.
--
-- ORDERING: run AFTER the Increment 2a/3 collectors have been deployed AND a full
-- collection cycle has re-populated the correct-id rows. Any not-yet-re-homed tokens
-- under a deleted network (the preview's token_count minus reincarnated_token_count)
-- are dropped until a future collection re-homes them.
--
-- Idempotent: the allow-listed rows are gone after the first run, so the predicate
-- matches nothing on re-run. Wrapped in a single transaction. Records the run in
-- _data_migrations for an audit trail.
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
WHERE n.chain_id IN ('eip155-900', 'eip155-501000101', 'eip155-1000', 'eip155-728126428')
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
--    header_link, and metadata. Only the correct-namespace rows (solana-501, tvm-195)
--    survive.
DELETE FROM network
WHERE network_id IN (SELECT network_id FROM _faked_networks);

INSERT INTO _data_migrations (name)
VALUES ('cleanup_nonevm_faked_networks')
ON CONFLICT (name) DO NOTHING;

COMMIT;
