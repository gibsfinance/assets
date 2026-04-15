# Gibs Assets

Token data aggregation, image serving, and list management. Collects from 30+ providers, deduplicates, and serves prioritized token images and metadata via API.

## Packages

| Package | Description |
|---------|-------------|
| `packages/server` | Collection pipeline, PostgreSQL storage, Express API |
| `packages/ui` | Frontend (being converted to React) |
| `packages/utils` | Shared utilities (fetch, logging, ERC-20 reads) |
| `packages/dexscreener` | DexScreener chain data scraper |

## Setup

```bash
git clone --recursive git@github.com:gibsfinance/assets.git
cd assets
yarn
yarn run setup
```

Requires Docker (PostgreSQL) and Node.js 24+.

## Collection

Collects token data from 30+ providers in a two-phase pipeline: discover (register providers/lists) then collect (fetch tokens/images). Provider ordering in `collectables.ts` determines image priority.

```bash
cd packages/server

# Full collection
yarn collect

# Specific providers
npx tsx src/bin/collect --providers=gibs,piteas,trustwallet --logger=raw
```

## API

Base URL: `https://gib.show`

### Lists

| Endpoint | Description |
|----------|-------------|
| `/list/` | All lists |
| `/list/{provider}/{key}` | Specific list |
| `/list/{provider}/{key}?chainId={id}` | Chain-filtered list |

### Images

| Endpoint | Description |
|----------|-------------|
| `/image/{chainId}/{address}` | Token image (priority-ordered) |
| `/image/{chainId}` | Network icon |
| `/image/direct/{imageHash}` | Direct by hash |
| `/image/fallback/{order}/{chainId}/{address}` | With explicit order + fallback |
| `/image/?i={chainId}/{address}&i=...` | Multi-source fallback |

### Tokens

| Endpoint | Description |
|----------|-------------|
| `/token/{chainId}/{address}` | Token metadata |

## Development

```bash
# Server
cd packages/server && yarn dev

# Tests
node --import tsx --test packages/server/test/

# TypeScript check
npx tsc --noEmit -p packages/server/tsconfig.json
```

## Data Sources

Aggregates from: Trust Wallet, PulseX, CoinGecko, Uniswap token lists, Etherscan, RouteScan, OmniBridge, Smoldapp, PLS369, and 20+ more. Each provider is a `BaseCollector` class with `discover()` and `collect()` phases.

## Submodules

- `submodules/trustwallet` — Trust Wallet token assets
- `submodules/pulsechain-assets` — PulseChain community assets
- `submodules/smoldapp-tokenassets` — Smoldapp token images
