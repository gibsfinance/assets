---
title: Token list format
description: The JSON shape of a token list that Gib.Show reads and writes.
sidebar:
  order: 3
---

Gib.Show uses the [Uniswap token list](https://tokenlists.org/) standard:

```json
{
  "name": "My Token List",
  "timestamp": "2026-03-21T00:00:00.000Z",
  "version": { "major": 1, "minor": 0, "patch": 0 },
  "tokens": [
    {
      "chainId": 1,
      "address": "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      "name": "Wrapped BTC",
      "symbol": "WBTC",
      "decimals": 8,
      "logoURI": "https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"
    }
  ]
}
```

Each token has a `chainId`, an `address`, a `name`, a `symbol`, `decimals` and a `logoURI`. A `logoURI` can point at any image. Pointing it at `https://gib.show/image/{chainId}/{address}` lets Gib.Show choose the image for you.

The version is a semantic version. When the members of a list change, publish a new version.

To read lists from Gib.Show, see [Token lists](/api-reference/token-lists/).
