ALTER TABLE "list" ADD COLUMN "license" text;--> statement-breakpoint
ALTER TABLE "list" ADD COLUMN "license_url" text;--> statement-breakpoint
ALTER TABLE "list" ADD COLUMN "attribution" text;--> statement-breakpoint
ALTER TABLE "list_token" ADD COLUMN "license" text;--> statement-breakpoint
-- Backfill LIST-level licence metadata for the five sources verified in
-- packages/server/src/server/image/attribution.ts's registry, by provider key.
-- Each statement is guarded to touch only a list whose relevant column is still
-- unset, so this is safe to re-run and never overwrites a value a collector (or
-- an operator) has already set explicitly.
--
-- list_token.license is deliberately left alone: the address a list actually
-- used for one entry's image is not recoverable from stored data (image.uri can
-- be overwritten by a later, unrelated list sharing the same content-addressed
-- image — see this migration's accompanying report), so there is nothing safe
-- to backfill there. Every list_token.license stays null — unknown, not
-- "unlicensed" — until the next collection run computes it from the address the
-- collector actually holds at that moment.
UPDATE "list" SET
    "license" = 'MIT',
    "license_url" = 'https://github.com/trustwallet/assets/blob/master/LICENSE',
    "attribution" = 'Copyright (c) 2019-2023 Trust Wallet - MIT'
  FROM "provider"
  WHERE "list"."provider_id" = "provider"."provider_id"
    AND "provider"."key" = 'trustwallet'
    AND "list"."license" IS NULL;--> statement-breakpoint
UPDATE "list" SET
    "license" = 'MIT',
    "license_url" = 'https://github.com/SmolDapp/tokenAssets/blob/main/LICENSE',
    "attribution" = 'Copyright (c) 2024 Smol - MIT'
  FROM "provider"
  WHERE "list"."provider_id" = "provider"."provider_id"
    AND "provider"."key" = 'smoldapp'
    AND "list"."license" IS NULL;--> statement-breakpoint
UPDATE "list" SET
    "license" = 'MIT',
    "license_url" = 'https://github.com/ethereum-lists/tokens/blob/master/LICENSE',
    "attribution" = 'Copyright (c) 2018 ethereum-lists - MIT'
  FROM "provider"
  WHERE "list"."provider_id" = "provider"."provider_id"
    AND "provider"."key" = 'ethereum-lists'
    AND "list"."license" IS NULL;--> statement-breakpoint
UPDATE "list" SET
    "license" = 'MIT',
    "license_url" = 'https://github.com/0xa3k5/web3icons/blob/main/LICENCE',
    "attribution" = 'Copyright (c) 2024 0xa3k5 - MIT'
  FROM "provider"
  WHERE "list"."provider_id" = "provider"."provider_id"
    AND "provider"."key" = 'web3icons'
    AND "list"."license" IS NULL;--> statement-breakpoint
-- pls369 carries no formal licence (see the registry entry's own reasoning), so
-- "license" stays null on purpose — only the evidence columns are filled in.
UPDATE "list" SET
    "license_url" = 'https://github.com/PLS369/pulsechain-assets/blob/main/README.md',
    "attribution" = 'PLS369 / pulsechain-assets - the source states its data is "open for all projects to use" but grants no formal licence.'
  FROM "provider"
  WHERE "list"."provider_id" = "provider"."provider_id"
    AND "provider"."key" = 'pls369'
    AND "list"."license_url" IS NULL;