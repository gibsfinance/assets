---
title: Configuration
description: Every environment variable the server, the collector and the interface read, with defaults.
sidebar:
  order: 2
---

The server and the collector read their settings from environment variables once, at start-up. Set them in your shell, your container definition or your process manager.

A secret (a key, a token) must be set in the environment only. Never write a secret in a file you commit.

## Server and database

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string. If you set nothing, the server uses a local database on port 5876. |
| `PORT` | No | Server port. The default is `3000`. |
| `CACHE_SECONDS` | No | Lifetime in seconds that the server puts in `cache-control` for images and for answers such as `/networks`, `/stats` and provider lists. The default is `3600`. A value that is not a positive number falls back to the default. |
| `ADMIN_TOKEN` | No | Bearer token that guards moderation endpoints and the `refresh` option. Unset by default. While it is unset, those endpoints answer 401. A secret. |
| `ROOT_URI` | No | The public address of the server. The server uses it to build the `/image/direct/<hash>` addresses that appear as `logoURI` in lists. The default is `http://localhost:3456`. |
| `GITHUB_OAUTH_CLIENT_ID` | No | GitHub OAuth application client identifier, used to publish lists from the studio. |
| `GITHUB_OAUTH_CLIENT_SECRET` | No | GitHub OAuth application client secret. A secret. Without these two settings, `/api/github/token` answers 503. |
| `PUBLIC_BASE_URL` | No | The API address the interface calls. It is read when the interface is built. Empty means the same origin. |
| `VITE_SERVICE_WORKER` | No | Set to `off` when you build the interface to ship a service worker that removes every cache and unregisters itself. See [Front end](/contributing/front-end/). |

## Collection

| Variable | Required | Description |
|----------|----------|-------------|
| `COINGECKO_API_KEY` | No | CoinGecko API key for token list collection. Without it the public host is used, slowly (one request every 12 seconds). |
| `COINGECKO_API_PLAN` | No | `demo` if the key is a free Demo key (sent to the public host in the `x-cg-demo-api-key` header). Any other value, or none, means a Pro key (Pro host, `x-cg-pro-api-key` header). Read by the top-tokens collector only. The full CoinGecko collector sends any key as a Pro key. |
| `COINGECKO_TOP_TOKENS_COUNT` | No | Tokens per chain in the `coingecko-top-tokens` lists. The default is `100`. |
| `COINGECKO_TOP_TOKENS_CHAINS` | No | Comma-separated chain ids that get a `top-tokens-<chain id>` list. The default is 1, 10, 25, 56, 100, 137, 250, 288, 369, 1101, 1284, 1285, 2222, 5000, 8453, 42161, 42220, 43114, 59144, 81457, 534352. A chain you leave out has its list retired on the next run. |
| `COINGECKO_TOP_TOKENS_MARKET_PAGES` | No | Most pages of 250 coins, ranked by market capitalisation, that one run reads. The default is `16`. |
| `COINGECKO_TOP_TOKENS_INTERVAL_MS` | No | Gap between CoinGecko requests in milliseconds. The defaults depend on the plan: 12000 without a key, 700 for Demo, 150 for Pro. |
| `ETHERSCAN_API_KEY` | No | Etherscan API V2 key. A secret, environment only. Unset turns the Etherscan collector off. See [Etherscan collector](/self-hosting/etherscan-collector/) for its other settings. |
| `IMAGE_MAX_AGE_HOURS` | No | How long a downloaded logo counts as fresh before the collector fetches it again, in hours (whole or fractional). The default is `168` (7 days). Lower it for fresher logos and slower runs. |
| `REFRESH_SUBMODULES` | No | `true` makes the collector refresh its artwork repositories at the start of each run. The worker image sets it to `true`. The default is off, because on a development machine those directories may be repositories someone is working in. |
| `SUBMODULES_DIRECTORY` | No | Where the artwork repositories are kept. |

## Runtime limits

These values are whole numbers of at least one. A value that is not a whole number of at least one falls back to the default. The defaults are the values the code used before they could be set, so an unset deployment behaves as it always did. A small host should lower them. Each unit of concurrency is a buffered download plus an image re-encode.

| Variable | Default | Effect |
|----------|---------|--------|
| `COLLECT_PROVIDER_CONCURRENCY` | 4 | Providers collected in parallel. The `--concurrency` option of the collect command overrides it. |
| `IMAGE_FETCH_CONCURRENCY` | 8 | Logos downloaded at once while a list's tokens are stored. |
| `IMAGE_PREWARM_CONCURRENCY` | 8 | Logos downloaded at once while a list is prewarmed. |
| `SHARP_CACHE_MEMORY_MB` | 16 | Size of the `sharp` pixel cache, in megabytes. `sharp` itself would allow 50. |
| `SHARP_CACHE_ITEMS` | 64 | Most operations that `sharp` keeps in its cache. |
| `SHARP_CONCURRENCY` | 1 | Threads that `libvips` may use. Both the server and the collector apply these three limits when they start. |
| `PLATE_RENDER_CONCURRENCY` | `SHARP_CONCURRENCY` | Plated images (`bg`, `contrast`) the server draws at once. Others wait in a line eight times as long, and one caller may hold four places in it; past that the server answers 503 with `Retry-After`. |
| `CLIENT_ADDRESS_HEADER` | none | Name of the request header that carries the real address of the caller, for example `cf-connecting-ip` behind the Cloudflare proxy or a Cloudflare Tunnel. Gib uses it to give each caller its own plate budget. Set it only when the server can be reached through that proxy alone, because a caller that reaches the server directly could write the header itself. With no header named, a connection from a private address (a proxy or a tunnel on your network) names no caller, and only the per-image and whole-service budgets apply. |

## Image storage

| Variable | Default | Effect |
|----------|---------|--------|
| `IMAGE_STORE` | `local` | Which storage holds image bytes: `local`, `s3`, `gcs`, `azure`, `ipfs`, or JSON for `tiered`, `mirrored` or `fallback`. |
| `IMAGE_STORE_DIR` | `<repository root>/image-store` | For `local`: the root of the store. |
| `IMAGE_BYTES_IN_DATABASE` | `true` | Whether new and refreshed images still keep their bytes in the `image.content` column as well as in the store. |

Every store has more settings. They are listed with each store on [Image storage](/self-hosting/image-storage/). `IMAGE_BYTES_IN_DATABASE` is explained on [Moving between stores](/self-hosting/moving-between-stores/#image-bytes-in-the-database).
