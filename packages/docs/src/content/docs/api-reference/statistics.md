---
title: Statistics
description: Per-chain counts of token addresses that have a usable image.
sidebar:
  order: 8
---

```
GET /stats
```

Returns, for each chain, how many token addresses have a usable image.

```bash
curl https://gib.show/stats
```

Each entry has these fields:

| Field | Meaning |
|-------|---------|
| `chainId` | The bare chain number, kept for older callers. |
| `chainIdentifier` | The prefixed identifier, for example `eip155-1`. |
| `count` | The number of token addresses with a usable image. |

The count comes from a light query that counts distinct tokens. It does not load the tokens. The answer is cached for the configured cache lifetime. See [Caching](/api-reference/caching/).
