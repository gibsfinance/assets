---
title: Token lists and ordering
description: How the ranking query orders tokens, and how lists that change membership get new versions.
sidebar:
  order: 8
---

## Token list ordering

`applyOrder()` in `db/index.ts` builds a common table expression with a `dense_rank` window function. This is the centre of the ranking:

```sql
dense_rank() OVER (
  PARTITION BY token_id, network_id
  ORDER BY
    ranking/1000 ASC,          -- provider group, from the order in collectables.ts
    format_preference ASC,     -- vector, then webp, then other raster
    major DESC, minor DESC,    -- list version
    default ASC, key ASC,      -- tie-breakers
    list_token_order_id ASC
)
```

This block shows the idea. The precise order is `listEntryPreferenceSql()`, which also puts the image tier first. See [Image serving](/contributing/image-serving/#choosing-an-image).

Two flags change the shape of the result:

- `dedupe`. `true` keeps only rank 1, and the image endpoints use it. `false` keeps all rows, and the token list endpoints use it.
- `sorted`. `true` adds an outer `ORDER BY` on ranking (`tokensByChain`). `false` adds no sort (`merged`).

Provider ranking is computed by `sync-order.ts` as `position × 1000 + subIndex`. See [Collectors](/contributing/collectors/#the-two-phase-contract).

## Lists that change membership

Jupiter is one such provider. `list_token` rows are only ever added. A token therefore leaves a list only when the list moves to a new version.

- `collect/jupiter.ts` files a new version (patch plus 1, in `list-membership.ts`) when a feed's members differ from the published version. It files none when they match. Superseded versions stay, for the by-address image route.
- A list that the run no longer produces (a tag below `MIN_LIST_SIZE`, or a retired tag) gets one empty published version. `getLists` serves the newest published version even when it is empty. It never serves an unpublished version beside a published sibling.
- `pruneSupersededListVersions` (`db/list-versions.ts`) trims versions older than the newest three. It never removes a row that is the only imaged row for its token.
- A feed that fails or answers empty leaves its list alone.

`versioned-lists.ts` shares this behaviour with `coingecko-top-tokens` and Etherscan:

- The same members reuse the version.
- A change files the next version.
- A chain that fails or answers nothing leaves its list alone.
- A chain that is dropped from the settings is retired to one empty version.

## Listing lists cheaply

`getLists` asks whether a list has any tokens with an `EXISTS` check. It does not join `list_token`. Do not bring back that join, and do not use a `SELECT *` spread. Either would make the cost grow with the number of tokens in every list.

## The ranked tokens response cache

The cached body of `/list/tokens/{chainId}` is fresh for six hours. The server rewarms the busiest chains on the same interval. Cache keys carry a shape version (`RESPONSE_SHAPE_VERSION`), so a change that alters a response retires its keys on purpose. See [Architecture](/contributing/architecture/#start-up-order).
