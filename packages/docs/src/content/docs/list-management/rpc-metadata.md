---
title: Loading metadata from a chain
description: Fetch token names, symbols and decimals straight from a blockchain node, and set your own node address.
sidebar:
  order: 5
---

The editor can read token data directly from the blockchain. It uses the `readContract` function of the viem library with the `ERC-20` interface. For each token it reads `name()`, `symbol()` and `decimals()`.

It supports every chain that viem has built in, and any chain for which you set a custom node address. Custom addresses are stored per chain id in your browser's `localStorage`.

## Set a custom node address

To add a custom address, for example for PulseChain, run this in your browser console:

```javascript
localStorage.setItem('gib-custom-rpcs', JSON.stringify({
  369: 'https://rpc.pulsechain.com'
}))
```

Reload the studio. "Load RPC" then uses that address for chain 369.
