-- Fully remove chain 661898459 ("Smart Mainnet"). The previous migration (0003)
-- only cleaned TrustWallet data; other providers may still reference this chain.
-- No legitimate tokens exist on this network — it was a mismapping artifact.

-- Delete all list_token entries for tokens under this network
DELETE FROM "list_token"
WHERE "token_id" IN (
  SELECT "token_id" FROM "token"
  WHERE "network_id" = (
    SELECT "network_id" FROM "network" WHERE "chain_id" = 'eip155-661898459'
  )
);--> statement-breakpoint

-- Delete all lists under this network
DELETE FROM "list"
WHERE "network_id" = (
  SELECT "network_id" FROM "network" WHERE "chain_id" = 'eip155-661898459'
);--> statement-breakpoint

-- Delete all tokens under this network
DELETE FROM "token"
WHERE "network_id" = (
  SELECT "network_id" FROM "network" WHERE "chain_id" = 'eip155-661898459'
);--> statement-breakpoint

-- Delete the network row itself
DELETE FROM "network"
WHERE "chain_id" = 'eip155-661898459';
