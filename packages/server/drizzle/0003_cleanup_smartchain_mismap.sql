-- TrustWallet's "smartchain" folder was misresolved to chain 661898459 ("Smart Mainnet")
-- instead of chain 56 (BNB Smart Chain). Delete list_token entries for TrustWallet lists
-- under the wrong network. Token and list cascade cleanup will follow on next collection.

-- Delete list_token rows for tokens under the wrong network from TrustWallet lists
DELETE FROM "list_token"
WHERE "list_id" IN (
  SELECT "list"."list_id"
  FROM "list"
  INNER JOIN "provider" ON "provider"."provider_id" = "list"."provider_id"
  WHERE "provider"."key" = 'trustwallet'
    AND "list"."network_id" = (
      SELECT "network_id" FROM "network" WHERE "chain_id" = 'eip155-661898459'
    )
);--> statement-breakpoint

-- Delete the TrustWallet lists themselves under the wrong network
DELETE FROM "list"
WHERE "provider_id" = (SELECT "provider_id" FROM "provider" WHERE "key" = 'trustwallet')
  AND "network_id" = (
    SELECT "network_id" FROM "network" WHERE "chain_id" = 'eip155-661898459'
  );--> statement-breakpoint

-- Delete orphaned tokens under the wrong network that have no remaining list_token refs
DELETE FROM "token"
WHERE "network_id" = (
  SELECT "network_id" FROM "network" WHERE "chain_id" = 'eip155-661898459'
)
AND NOT EXISTS (
  SELECT 1 FROM "list_token" WHERE "list_token"."token_id" = "token"."token_id"
);
