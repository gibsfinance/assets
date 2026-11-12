---
title: Image priority
description: How Gib.Show chooses one image when several providers have an image for the same token.
sidebar:
  order: 4
---

Many providers can have an image for the same token. Gib.Show serves one of them. It decides by the steps below, in this order. The same rule picks the `logoURI` in token lists, so the `logoURI` of a token names the image that `/image/{chainId}/{address}` serves.

1. **A usable stored image comes first.** An image that Gib.Show stores beats an image that only links to a source. A usable image on a link-only host, such as DeBank, comes next. Tokens with no image come last.
2. **A current list version beats an old one.** This step applies to the by-address image route. Token lists read current versions only.
3. **Provider ranking.** Providers are sorted by trust. Curated and trusted providers such as Trust Wallet and SmolDapp rank above aggregators. Providers are grouped in blocks, and the block is compared first.
4. **Format, inside a provider group.** Vector images (`svg`) are preferred over raster images. This preference works inside one provider group. It does not lift an aggregator's vector image above a trusted provider's raster image.
5. **Newer list versions are preferred** (major, then minor, then patch).
6. **Tie-breakers.** The list's default flag, then the list key, then the order in which the entries were stored.

If the chosen image is unavailable, the next-best image is served.

You can narrow the choice with `providerKey`, `listKey`, `only` and `license`. See [Image options](/api-reference/image-options/). You can pick another provider order with the [explicit order routes](/api-reference/images/#get-an-image-with-an-explicit-order).

## Provider order

The order of providers in the collector registry sets the ranking. Higher-ranked providers include:

- `gibs`, which is curated by hand.
- `trustwallet`, which has full-size `png` images.
- `smoldapp`, which has vector images.
- `piteas` and `pls369`, which are specific to PulseChain.

CoinGecko ranks lower but covers the most tokens. Gib.Show stores both its `/thumb/` (25 by 25) and `/large/` (250 by 250) variants.

Bridge aggregators rank below every curated source and above the plain metadata dumps. They publish only tokens they themselves vouch for.
