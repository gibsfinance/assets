---
title: Collection
description: How the collector gathers token data and images, how providers are ranked, and which lists it builds.
sidebar:
  order: 5
---

The engine ships with more than 30 collectors. A self-hosted instance chooses which providers it collects from.

```bash
# Run collection (fetches from all providers)
yarn collect

# Only some providers
cd packages/server
npx tsx src/bin/collect --providers=gibs,piteas,trustwallet --logger=raw
```

In a production deployment the collector runs on a schedule. A run discovers token lists, fetches images and syncs the priority order. Each run works in two phases:

1. **Discover.** Create the provider, list and network rows. No images yet.
2. **Collect.** Fetch tokens and images, clean the images, and store them.

Tune the work the collector does at once with the [runtime limits](/self-hosting/configuration/#runtime-limits).

## Provider priority

Image priority comes from the provider order in `packages/server/src/collect/collectables.ts`. A lower position means a higher priority. Vector images are preferred over raster images within a provider group. Higher-ranked providers include:

- `gibs`, which is curated by hand.
- `trustwallet`, which has full-size `png` images.
- `smoldapp`, which has vector images.
- `piteas` and `pls369`, which are specific to PulseChain.

CoinGecko ranks lower but covers the most tokens. The system stores both `/thumb/` (25 by 25) and `/large/` (250 by 250) variants.

The full rule is on [Image priority](/api-reference/image-priority/).

## Top tokens per chain from CoinGecko

The `coingecko-top-tokens` provider builds one list per chain, named `top-tokens-<chain id>`. For example, `/list/coingecko-top-tokens/top-tokens-56` holds the leading tokens on BNB Smart Chain. Tokens come in market capitalisation order. Native coins have no contract address and never appear.

Set `COINGECKO_API_KEY` and `COINGECKO_API_PLAN`, and tune the list with the `COINGECKO_TOP_TOKENS_*` settings. See [Configuration](/self-hosting/configuration/#collection).

A run makes at most 39 requests with the default settings: 2, plus at most `COINGECKO_TOP_TOKENS_MARKET_PAGES` market pages, plus one token list request per chain. The client spaces the requests to stay under CoinGecko's limits. On a 429 answer it waits for the time in `retry-after` (60 seconds if the header is absent). After a 5xx answer or a dropped connection it waits 5 seconds longer for each retry, up to 5 retries.

## Etherscan logos

The `etherscan` collector adds names and logos for tokens that other providers already rank. See [Etherscan collector](/self-hosting/etherscan-collector/).

## Lists that change membership

The Jupiter collector and the top-tokens collectors file a new list version when the members of a list change, and none when they do not. If a feed fails or answers empty, the list stays as it was. See [Token lists and ordering](/contributing/token-lists-and-ordering/#lists-that-change-membership).
