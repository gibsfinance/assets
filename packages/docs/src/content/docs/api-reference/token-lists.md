---
title: Token lists
description: How to read the list index, single lists, versioned lists, ranked tokens per chain and merged lists.
sidebar:
  order: 5
---

Lists follow the [Uniswap token list](https://tokenlists.org/) format. Each token carries a `logoURI` that points at a Gib.Show image. See [Token list format](/list-management/token-list-format/) for the shape of a list.

## List all lists

```
GET /list
```

Returns metadata for every available list: provider, chain and version. You can filter with these query parameters:

| Parameter | Filters by |
|-----------|------------|
| `key` | List key. |
| `name` | List name. |
| `provider_key` | Provider key. |
| `chain_id` | Chain, prefixed (`eip155-369`) or bare (`369`). |
| `chain_type` | Chain family, for example `evm`. |
| `default` | `true` for default lists, `false` for the others. |
| `major`, `minor`, `patch` | Version numbers. Each must be an integer. |

A bad value answers 400. For example, `default` must be `true` or `false`, and values must not be empty.

## Get one list

```
GET /list/{providerKey}/{listKey}?chainId={chainId}
```

Returns a token list from one provider. Leave out `listKey` (`/list/{providerKey}`) to get the provider's default list.

Query parameters:

| Parameter | Meaning |
|-----------|---------|
| `chainId` | Keep only tokens on one chain. |
| `decimals` | Keep only tokens with these decimals. Repeat the parameter: `decimals=18&decimals=8`. |
| `extensions` | Add optional token fields. Comma-separated or repeated. Known values are `bridgeInfo` and `headerUri`. |

```bash
# All lists
curl https://gib.show/list

# PulseChain tokens from Piteas
curl "https://gib.show/list/piteas/exchange?chainId=369"

# Ethereum tokens from Trust Wallet
curl https://gib.show/list/trustwallet/wallet-ethereum
```

An unknown provider, list or order answers 404. User submissions have provider keys that start with `user-`.

## Get a versioned list

```
GET /list/{providerKey}/{listKey}/{version}
```

Returns one version of a list, for example `/list/pulsex/extended/1.0.0`. The version is a semantic version.

## Get ranked tokens for a chain

```
GET /list/tokens/{chainId}
```

Returns every token of one chain, with duplicates removed, ranked by list priority. Each token has a `sources` array that shows which lists include it. The response also carries totals.

| Parameter | Meaning |
|-----------|---------|
| `limit` | Most tokens returned. The range is 1 to 100000 and the default is 50000. A value that is not a number, zero, or negative falls back to the default. |
| `format` | Leave out for the default body, an array of token objects. `compact` sends a smaller body. Any other value answers 400. |
| `fields` | With `format=compact` only. A comma-separated subset of `address`, `name`, `symbol`, `decimals`, `logoURI` and `sources`. See below. |

The response is cached for 6 hours fresh and 24 hours stale (`cache-control: public, max-age=21600, stale-while-revalidate=86400`). The busiest chains are kept warm all the time.

A missing or invalid `chainId` answers 400. The numbers in `eip155` references must be numeric.

### The compact format

`format=compact` sends each source name once and each token as an array of values. The body is about half the size and parses several times faster. It works together with `limit`.

To decode a row, pair `fields[i]` with `row[i]`. Then replace each integer in the `sources` value with the entry at that index in the top-level `sources` array. Every row shares the `chainId` and `chainIdentifier` of the response.

`fields` rules:

- `address` is required.
- Rows and the echoed `fields` always follow this order: `address`, `name`, `symbol`, `decimals`, `logoURI`, `sources`. They do so whatever order you asked for.
- The top-level `sources` array is sent only when you select `sources`.
- Leave `fields` out to get every field. Dropping `logoURI` roughly halves the raw size.
- Gib.Show answers 400 when you use `fields` without `format=compact`, when a name is unknown or repeated, or when `address` is missing.

An empty `sources` array for a token means the default body has no `sources` property for that token.

```bash
curl "https://gib.show/list/tokens/eip155-369?format=compact&fields=address,name,symbol,decimals,sources"
```

## Get a merged list

```
GET /list/merged/{order}?chainId={chainId}
```

Returns a token list that merges tokens across providers for one chain, using a named ordering such as `default` or an explicit order identifier. `chainId` is required, because the merge cannot complete across every chain at once. A missing `chainId` answers 400. You can also filter with `decimals`.

## Rebuild a cached answer

Several endpoints sit behind a server cache. The operator can force a rebuild with `refresh=1` and an admin bearer token. Without a valid token the request is rejected with 401, and it is never served from the cache. Refresh responses carry `cache-control: no-store`. You do not need this as a normal user.
