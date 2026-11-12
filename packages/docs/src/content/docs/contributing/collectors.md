---
title: Collectors
description: How collectors work, how to add one, and the details of the bridge aggregator, top-tokens, Etherscan and artwork repository collectors.
sidebar:
  order: 7
---

A collector reads one provider and writes lists, tokens and images. The engine registers more than 30 collectors in `packages/server/src/collect/collectables.ts`. **The order in that file is the image priority.** A lower index means a higher priority.

```
0: gibs           5: pulsechain       10: trustwallet
1: pulsex         6: internetmoney    11: piteas
2: smoldapp       7: midgard          12: pls369
3: dexscreener    8: pumptires        13: balancer
4: countries      9: routescan        14: phux, then the rest
```

This is the start of the order at the time of writing. The file is the truth, and it changes.

## The two-phase contract

Every collector extends `BaseCollector` and follows two phases:

1. **Discover.** Create the provider, list and network rows only. No images.
2. **Collect.** Fetch tokens and images, clean them and store them.

After the first phase, `sync-order.ts` assigns `ranking = position × 1000 + subIndex` to each provider.

## Add a collector

1. Create the collector in `src/collect/` and extend `BaseCollector`.
2. Register it in **two** files:
   - `collectables.ts`, where the position is the priority.
   - `collectable-order.ts`, which holds the same order as a plain list. The database layer uses it to rank a provider without importing every collector.

A test compares the two files and fails if they disagree.

Two shortcuts exist:

- A source that is a plain token list needs no new class. `RemoteTokenListCollector` handles it.
- A bridge aggregator needs only a fetch-and-narrow function. `AggregatorCollector` handles the rest.

To change image priority, reorder the entries in `collectables.ts`.

## Bridge aggregators

`lifi`, `relay`, `debridge` and `near-intents` share one collector, `collect/aggregator.ts`. An aggregator publishes everything it will route, not a curated list. Each source narrows its own response into a common shape (`aggregator-parse.ts`). The shared collector then groups by chain, makes one list per chain, inserts the rows and fetches the artwork.

Aggregators rank below every curated source and above the metadata dumps. Most of their artwork is mirrored from Trust Wallet and CoinGecko, which already rank above them. An aggregator should fill a gap, not outrank the source it copied from.

**Only tokens that the aggregator itself vouches for are collected.** LiFi marks 3,579 of its 17,495 tokens as `flagged`. Relay returns outright spam beside Tether. The output of this service is artwork, and a convincing logo on a flagged token is help that a scam does not otherwise get. The filter is a security boundary, not a quality preference.

**Rank follows where the artwork came from, and it is measured, not assumed.** Rank settles contested tokens only. Roughly a fifth of each aggregator's artwork is for tokens that nothing else covers, and those are won from any position. So the question is whether the aggregator's picture is its own or a copy of one that ranks above it.

- LiFi's is its own (3 percent CoinGecko, mostly DeBank), so it sits above CoinGecko.
- Relay's is CoinGecko's, linked directly (94 percent).
- deBridge's is CoinGecko's too, re-hosted on deBridge's own store so that the address looks first-hand, while 80 percent of the records carry a `coingecko` tag. Both Relay and deBridge sit below CoinGecko.

Check the tags and the hosts before you move one.

**Every aggregator numbers its chains its own way, and no such number is a chain id until you check it.** LiFi invents ids for Solana, Bitcoin and Sui. Relay reports a virtual machine type per token. deBridge keys its whole API on internal numbers (HyperEVM is 100000022 there) and states the real one separately as `originalChainId`. NEAR Intents uses short names. Read the field that means a chain, verify it against the chain registry, and skip what you cannot verify rather than guess.

## Vendored artwork repositories

Four collectors (`trustwallet`, `smoldapp`, `pls369` and `ethereum-lists`) read repositories from `submodules/` on disk.

- `src/submodule-refresh.ts` owns how those repositories get there. It fetches at depth 1, with `--filter=blob:none`, and uses a sparse checkout of only the directories that a collector walks (`sparsePaths`). If a collector starts to read another directory, add it there.
- The collector refreshes the repositories its providers read at the start of every run (`bin/collect.ts`) when `REFRESH_SUBMODULES=true`. The worker image sets it. A repository that cannot be fetched keeps the copy already on disk. It is off by default, because on a development machine these directories are git submodules that somebody may be working in. `SUBMODULES_DIRECTORY` moves the directory (`paths.ts`).
- `Dockerfile.worker` bakes a first copy with `scripts/refresh-submodules.mjs`. That script runs the same module under Node's own type stripping, which is why `submodule-refresh.ts` has no run-time relative imports. Pass `--build-arg SUBMODULES_SNAPSHOT=<anything new>` to get a copy newer than the cached layer.
- Both images install with `yarn workspaces focus server --production`, in a stage that holds only the package manifests. Both run TypeScript from source. The server image therefore builds only `packages/ui` (the typecheck job gates the rest), and the worker image builds nothing.

## Top tokens per chain: `coingecko-top-tokens`

The provider `coingecko-top-tokens` makes one list per chain, named `top-tokens-<chain id>`, for example `/list/coingecko-top-tokens/top-tokens-56`.

It is a provider of its own, not more lists under `coingecko`. The full collector keeps its bare-chain-id lists, its unranked order and its ranking slots. A separate key lets this collector fail, be ranked and be switched off by itself. It sits directly below `coingecko` in `collectable-order.ts`. Both serve CoinGecko's own artwork, so it decides no contested token.

**Sources**

- `/asset_platforms` gives the chain id to platform id map, through `chain_identifier`.
- `/coins/list?include_platform=true` gives the address by platform.
- `/coins/markets?order=market_cap_desc&per_page=250` gives rank, name, symbol and logo.
- `/token_lists/{platform}/all.json` gives decimals.

A token is a coin with a valid contract address on the chain, in market capitalisation order. Native coins have no contract address and never appear. A token that the token list lacks is stored with decimals 0, the value the full collector uses. An existing token row is never overwritten.

**Reading pages.** Market pages are read until every chain has enough tokens, the pages end, or `COINGECKO_TOP_TOKENS_MARKET_PAGES` is reached. If a page fails, a chain that already has its full count is filed, and every other chain keeps its list.

**Requests per run.** There are 2, plus at most `COINGECKO_TOP_TOKENS_MARKET_PAGES` market pages, plus one token list per chain. With the defaults that is at most 39. `coingecko-client.ts` spaces them: 12 seconds without a key, 700 milliseconds for Demo and 150 milliseconds for Pro, under limits of 5 to 15, 100 and plan-dependent calls a minute. It waits for `retry-after` (else 60 seconds) on a 429 answer. It waits 5 seconds longer per retry on a 5xx answer or a dropped connection, up to 5 retries. Every attempt counts against CoinGecko's limit, so each one takes its turn first.

**Membership versioning** is the shared one in `versioned-lists.ts`. See [Token lists and ordering](/contributing/token-lists-and-ordering/#lists-that-change-membership). A chain dropped from `COINGECKO_TOP_TOKENS_CHAINS` is retired to one empty version. Images go through `fetchImageAndStoreForToken`.

**Settings** are `COINGECKO_API_KEY`, `COINGECKO_API_PLAN` (`demo` or Pro, default Pro), `COINGECKO_TOP_TOKENS_COUNT`, `_CHAINS`, `_MARKET_PAGES` and `_INTERVAL_MS`. See [Configuration](/self-hosting/configuration/#collection). The full `coingecko` collector still sends any key to the Pro host as a query parameter, which CoinGecko documents for Pro keys only. The top-tokens collector follows the documented Demo and Pro forms.

CoinGecko's pages do not state a plan requirement for these endpoints. The Demo documentation lists all four.

## The Etherscan collector (API V2)

The old `etherscan` collector scraped explorer pages with a headless browser, and it was removed. The current `collect/etherscan.ts` uses the documented Etherscan API V2 under the same provider key `etherscan`. Existing rows and `/list/etherscan/top-tokens` stay valid. That list is frozen and empty.

- Etherscan has no endpoint that ranks tokens (see `docs.etherscan.io/endpoint-overview`). The collector fetches `tokeninfo` for tokens that other providers' lists already rank (`getTopTokenAddresses`, `ETHERSCAN_SOURCE_LISTS`).
- The default reads the `coingecko-top-tokens` lists first (`top-tokens-<chain id>`), then the `top-tokens*` lists of `routescan`. A token that both name keeps its earlier place. The provider key and the list key prefix are constants in `coingecko-top-tokens-settings.ts`, which Etherscan imports.
- `tokeninfo` is API Pro (Standard plan and up), at 2 calls per second on every plan. The free plan covers only some chains. Nothing assumes what the key may do. Discovery runs a probe (`etherscan-capability.ts`) once per run, and the collector uses only chain and endpoint pairs that answered `ok`. Others get one log line each, are not failures and are not retried. A free key therefore collects nothing and logs why.
- A refusal in the middle of a chain stops that chain and leaves its published list as it was.
- Lists are `top-tokens-<chainId>`. They are versioned by membership through `versioned-lists.ts`, which Jupiter and `coingecko-top-tokens` share.
- `etherscan-response.ts` classifies answers from their text (status 0 with the reason in `message` or `result`). Tests use the exact refusal strings in `__testing__/etherscan-fixtures.ts`. Add a new refusal there first.
- The rank is just below `arbitrum`, below every curated list and aggregator. This is a precaution, not a measurement. Revisit it once a key that can call `tokeninfo` has produced data.
- The `image` field is the logo. Only an absolute address is kept. A relative one is dropped because its host is unknown per chain. This is unverified against live data, because no key that can call `tokeninfo` has been available.
- The operator command `yarn workspace server run start:etherscan check` prints what the key can use (never the key) and exits with status 1 when no chain can be collected.

Operator-facing settings are on [Etherscan collector](/self-hosting/etherscan-collector/).
