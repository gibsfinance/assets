---
title: Search
description: Find tokens by name, symbol or address across every chain, or inside one chain.
sidebar:
  order: 6
---

```
GET /list/search?q={term}
```

Search matches a substring of the token name and symbol, and an exact token address. It returns one entry per token, in the same shape as the chain-scoped list endpoints.

```bash
# Every chain
curl "https://gib.show/list/search?q=usdc"

# One chain
curl "https://gib.show/list/search?q=usdc&chainId=eip155-369"
```

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `q` | Yes | The search term. It must be 2 to 64 characters long. The characters `%` and `_` match literally. |
| `chainId` | No | Search one chain only. Prefixed (`eip155-369`) or bare (`369`). This narrows the query itself, not just the results. |
| `limit` | No | Most tokens returned. The default is 100. The cap is 1000. |

A missing `q`, a term outside 2 to 64 characters, or a `chainId` that exists in several namespaces answers 400. For an ambiguous `chainId`, ask again with the prefixed form.

## Response

```json
{
  "query": "usdc",
  "chainIdentifier": "eip155-369",
  "truncated": false,
  "tokens": []
}
```

- `query` is the term as searched, with spaces trimmed.
- `chainIdentifier` is present only when you scoped the search to one chain.
- `truncated` is `true` when more tokens matched than were returned.
- `tokens` holds the matches, best first.

There is no `total` and there is no `offset`. The query stops at a candidate cap, so the real count is not known. A cap together with an offset would silently skip matches. Narrow the term or pass `chainId` instead of paging.

## How results are ranked

The order is:

1. How closely the term matches (the relevance tier).
2. How popular the token is, measured by how many list entries carry it.
3. Provider ranking.

Provider ranking comes last because it orders providers, not tokens. The search always uses the default ordering. It does not accept `extensions` or `decimals` filters.
