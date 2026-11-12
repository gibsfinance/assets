---
title: Etherscan collector
description: How the Etherscan collector works, how to check your key, and its settings.
sidebar:
  order: 6
---

The `etherscan` collector reads token names, decimals and logos from the Etherscan API V2 (`https://api.etherscan.io/v2/api`).

Etherscan has no endpoint that ranks tokens, so the collector does not find tokens. It takes the first tokens of other providers' lists that are already in your database. Then it asks the Etherscan `tokeninfo` endpoint about each one.

## What your key can do

`tokeninfo` is an API Pro endpoint (Standard plan and above). The free plan covers only some chains.

The collector does not assume what your key may do. It asks Etherscan first, once per chain, and then uses only the chains and endpoints that answered. A chain or endpoint that your key cannot use is skipped with one log line. It is never counted as a failure and is not asked again in the run. With a free key, the collector logs that `tokeninfo` needs API Pro and collects nothing.

## Check your key

Check your key before you rely on it. The command prints one row per chain and never prints the key:

```bash
cd packages/server
ETHERSCAN_API_KEY=... yarn start:etherscan check    # exits 1 when no chain can be collected
```

## Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `ETHERSCAN_API_KEY` | unset | Your Etherscan key. A secret: set it in the environment only. |
| `ETHERSCAN_CALLS_PER_SECOND` | `3` | Your plan's calls per second: Free 3, Lite 5, Standard 10, Advanced 20, Professional 30. `tokeninfo` is also capped at 2 per second on every plan, and the collector applies the lower number. On a rate message it waits 1, 2, 4 and then 8 seconds, and tries again, at most four times. |
| `ETHERSCAN_TOKENS_PER_CHAIN` | `100` | Most tokens fetched for one chain in one run. At 2 calls per second, 100 tokens take about 50 seconds. |
| `ETHERSCAN_SOURCE_LISTS` | `coingecko:top-tokens,routescan:top-tokens` | Comma-separated `provider` or `provider:listKeyPrefix`. The lists of those providers on the chain, newest published version, name the tokens to fetch, best first. A token that two lists name keeps its earlier place. |
| `ETHERSCAN_CHAIN_IDS` | every known chain | Comma-separated chain ids to limit the run to. Known chains: 1, 10, 56, 100, 137, 5000, 8453, 42161, 42220, 43114, 59144. |

A limit that is not a whole number of at least one falls back to its default. A source list or chain list with no usable entry falls back to its default too.

## What it publishes

Each usable chain publishes one list, `etherscan/top-tokens-<chainId>`. A list gets a new version only when its members change.

The `image` field of an Etherscan answer is the logo. Gib keeps only an absolute address, because a relative one has no known host.

Limits and plans are on the Etherscan page: <https://docs.etherscan.io/resources/rate-limits>.
