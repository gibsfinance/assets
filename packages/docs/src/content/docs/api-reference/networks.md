---
title: Networks
description: The endpoint that lists every supported network, and the chains Gib.Show covers.
sidebar:
  order: 7
---

```
GET /networks
```

Returns every supported network with its chain identifiers and image hash. That includes EVM chains and the non-EVM chains the service also indexes, such as Solana and Tron.

```bash
curl https://gib.show/networks
```

Each network has the bare chain id and the prefixed identifier. For the logo of a network, use `/image/{chainId}`. See [Images](/api-reference/images/).

The response is cached. See [Caching](/api-reference/caching/).

## Supported chains

Major chains include Ethereum (1), PulseChain (369), Arbitrum (42161), Polygon (137), BNB (56), Base (8453), Optimism (10) and Avalanche (43114). More than 200 other chains are supported. Call `/networks` for the full list.

See [Chain identifiers](/api-reference/overview/#chain-identifiers) for how chains are named.
