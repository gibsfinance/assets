-- Preview: faked non-Ethereum-Virtual-Machine networks eligible for cleanup.
--
-- Before Increment 2a/3, the collectors filed Solana / Tron / The-Open-Network
-- tokens under fabricated Ethereum-Virtual-Machine chain ids (insertNetworkFromChainId
-- normalized a bare coin number to "eip155-<n>"): Solana -> eip155-900, Tron ->
-- eip155-1000, and a "tvm"-typed eip155-1 for The-Open-Network (which collides on
-- chain_id with real Ethereum mainnet but is a distinct network_id). The collectors
-- now write the correct coin-type ids instead (solana-501, tvm-195, ton-607), so those
-- fabricated rows are stale duplicates.
--
-- This query is READ-ONLY. Run it on staging (then production) FIRST and eyeball the
-- output before running cleanup-nonevm-faked-networks.sql. It lists every network the
-- cleanup would delete, plus a "reincarnated_token_count" that shows how many of each
-- faked network's tokens already exist under a correct (non-eip155) network id — when
-- that count matches token_count, deleting the faked network loses no unique data.
--
-- Run from packages/server:
--   psql "$DATABASE_URL" -f scripts/preview-nonevm-faked-networks.sql
--
-- Candidate predicate (identical to the cleanup script):
--   * chain_id LIKE 'eip155-%'  -> only Ethereum-Virtual-Machine-namespace rows are
--     ever considered, so the correct solana-501 / tvm-195 / ton-607 rows are untouched.
--   * has at least one token   -> never deletes a real-but-empty chain (vacuous match).
--   * NO token shaped like a real Ethereum-Virtual-Machine address (0x + 40 hex) -> a
--     genuine Ethereum-Virtual-Machine chain always has such tokens, so it is protected;
--     Solana/Tron base58 and The-Open-Network base64url ids never match that shape.

WITH faked AS (
  SELECT n.network_id, n.chain_id, n.type
  FROM network n
  WHERE n.chain_id LIKE 'eip155-%'
    AND EXISTS (SELECT 1 FROM token t WHERE t.network_id = n.network_id)
    AND NOT EXISTS (
      SELECT 1 FROM token t
      WHERE t.network_id = n.network_id
        AND t.provided_id::text ~* '^0x[0-9a-f]{40}$'
    )
)
SELECT
  f.chain_id,
  f.type,
  f.network_id,
  (SELECT count(*) FROM token t WHERE t.network_id = f.network_id) AS token_count,
  (SELECT count(*) FROM list l WHERE l.network_id = f.network_id) AS list_count,
  -- How many of this faked network's provided_ids already exist under a correct
  -- (non-eip155) network. token_count == reincarnated_token_count => safe to delete.
  (
    SELECT count(*)
    FROM token t
    WHERE t.network_id = f.network_id
      AND EXISTS (
        SELECT 1
        FROM token c
        JOIN network cn ON cn.network_id = c.network_id
        WHERE cn.chain_id NOT LIKE 'eip155-%'
          AND c.provided_id = t.provided_id
      )
  ) AS reincarnated_token_count,
  (
    SELECT array_agg(sample ORDER BY sample)
    FROM (
      SELECT t.provided_id::text AS sample
      FROM token t
      WHERE t.network_id = f.network_id
      ORDER BY t.provided_id
      LIMIT 5
    ) s
  ) AS sample_provided_ids
FROM faked f
ORDER BY f.chain_id;
