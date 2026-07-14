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
--   * chain_id in an explicit allow-list of the four reviewed faked Solana/Tron
--     networks (eip155-900, eip155-501000101, eip155-1000, eip155-728126428). A
--     broader "any eip155 network with no hex token" predicate also matched three
--     chains that are NOT faked duplicates: Ontology (eip155-58, a REAL
--     Ethereum-Virtual-Machine chain, never delete), Algorand (eip155-4160,
--     fabricated but now re-homable to algorand-283), and BRC-20/Runes
--     (eip155-2203, a Bitcoin token standard, no coin type). So the predicate is
--     narrowed to the reviewed Solana/Tron duplicates only.
--   * NO token shaped like a real Ethereum-Virtual-Machine address (0x + 40 hex) -> a
--     genuine Ethereum-Virtual-Machine chain always has such tokens, so it is protected;
--     Solana base58 and Tron numeric/base58 ids never match that shape. There is NO
--     "has at least one token" guard: after the collectors re-homed their data, some of
--     these ids are token-LESS husks (a bare network row still advertising an image_hash
--     -- eip155-900's is orphaned, so /image/eip155-900 404s). A husk has zero tokens, so
--     the hex guard is vacuously true for it; requiring a token would strand these husks
--     and their dangling images. The allow-list is the safety here -- none of the four is
--     a real Ethereum-Virtual-Machine chain, so "real-but-empty" cannot apply to them.

WITH faked AS (
  SELECT n.network_id, n.chain_id, n.type
  FROM network n
  WHERE n.chain_id IN ('eip155-900', 'eip155-501000101', 'eip155-1000', 'eip155-728126428')
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
