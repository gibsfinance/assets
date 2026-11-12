---
title: First requests
description: The four URLs most people use first, with examples you can copy.
sidebar:
  order: 2
---

This page shows the URLs you will use most. Each one works in a browser, in `curl` and in an `img` tag.

## A token image by chain and address

```
https://gib.show/image/{chainId}/{address}
```

`chainId` is the number of the chain, for example `1` for Ethereum or `369` for PulseChain. `address` is the token contract address.

```bash
# Wrapped Bitcoin on Ethereum
curl https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599

# A PulseChain token
curl https://gib.show/image/369/0xa1077a294dde1b09bb078844df40758a5d0f9a27
```

Gib answers with the image itself. If it has no image for the token, it answers with a 404 status.

Chains that are not Ethereum-style, such as Solana and Tron, need the prefixed chain identifier. See [Chain identifiers](/api-reference/overview/#chain-identifiers).

### Resize and change the format

Add `w`, `h` and `as` to get a smaller image in a lighter format:

```bash
curl "https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?w=72&h=72&as=webp"
```

Gib never makes an image larger than its source. [Image options](/api-reference/image-options/) lists every option.

## A network logo

```
https://gib.show/image/{chainId}
```

```bash
curl https://gib.show/image/1
```

This is useful for chain selectors and network badges.

## A token list

```
https://gib.show/list/{providerKey}/{listKey}?chainId={chainId}
```

```bash
# All lists the instance knows about
curl https://gib.show/list

# PulseChain tokens from Piteas
curl "https://gib.show/list/piteas/exchange?chainId=369"

# Ethereum tokens from Trust Wallet
curl https://gib.show/list/trustwallet/wallet-ethereum
```

The answer is a token list in the [Uniswap token list](https://tokenlists.org/) format. Each token has a `logoURI` that points back at the same instance. See [Token lists](/api-reference/token-lists/).

To read the best tokens of one chain from all providers at once, use `/list/tokens/{chainId}`.

## A search

```bash
curl "https://gib.show/list/search?q=usdc&chainId=eip155-369"
```

Search matches the name, the symbol and the address. Leave out `chainId` to search every chain. See [Search](/api-reference/search/).

## Put an image in a page

```html
<img
  src="https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?w=64&h=64&as=webp"
  width="32"
  height="32"
  alt="WBTC"
/>
```

Ask for twice the size you show. That keeps the image sharp on high-density screens. More examples are in [Integration examples](/api-reference/integration-examples/).

## Next steps

- [API reference overview](/api-reference/overview/)
- [Endpoint reference](/reference/)
- [Build your own token list](/list-management/overview/)
