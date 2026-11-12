---
title: Token search
description: How the search query works in two stages, and why both scores must stay in the first stage.
sidebar:
  order: 9
---

The endpoint is `GET /list/search?q=`. `searchTokens()` in `db/index.ts` runs the query, and the handler is in `list/handlers.ts`. The public behaviour is on [Search](/api-reference/search/).

## Two stages

1. The first stage reads `token`. It scores each match by relevance tier, and by how many list entries carry the token. Then it cuts to the candidate limit.
2. The second stage resolves the winning list entry for the survivors only.

**Both scores must stay in the first stage.** Anything applied after the cut only sorts whatever the cut kept. That is the bug that once made a search for "usdc" answer with a bridged token on an obscure chain, while USD Coin was never a candidate.

## Final order

The final order is relevance tier, then popularity, then provider ranking. Ranking is last of the three because it orders providers, not tokens.

## Indexes

Migration `0016` adds the `pg_trgm` indexes that the substring predicate needs. Without them, the query falls back to a full scan of `token`. That is correct, and roughly seven times slower. The handler neither tests for the indexes nor changes its behaviour.

## Reporting truncation

The handler asks the query for one token more than the caller wants, only to learn whether more exist. A second `COUNT(*)` would give an honest total, but it would double the work of every search. It would also be a wrong total once it passed the candidate cap. So the response has a `truncated` flag and no `total`, and it has no offset.

The cache key for a search holds the order, the lower-cased term, the chain and the limit.

## Route order

The route registers **before** `/:providerKey`, which would otherwise swallow it. See `packages/server/src/server/list/index.ts`.

## The local filter in the interface

The interface has two searches. The cross-chain search is `hooks/useTokenSearch.ts`, and it calls this endpoint. The local filter over an already loaded chain is in `utils/token-search.ts`. See [Front end](/contributing/front-end/#interface-utilities).
