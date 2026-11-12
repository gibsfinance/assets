---
title: Images
description: How to request token images and network images, by address, by hash, with fallback, or in a batch.
sidebar:
  order: 2
---

The image endpoints return image bytes. Options such as `w`, `h` and `as` are explained on [Image options](/api-reference/image-options/).

## Get a token image

```
GET /image/{chainId}/{address}
```

Returns the highest-priority image for a token. [Image priority](/api-reference/image-priority/) explains how Gib chooses.

**Path parameters**

- `chainId` is the chain identifier, prefixed (`eip155-1`) or bare (`1` for Ethereum, `369` for PulseChain). See [Chain identifiers](/api-reference/overview/#chain-identifiers).
- `address` is the token contract address. Use `0x...` for Ethereum-style (`eip155`) chains. Use a base58 address or another chain-native identifier for other chains.

**Examples**

```bash
# Original image
curl https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599

# 72x72 WebP (a good size for thumbnails)
curl "https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?w=72&h=72&as=webp"

# Network logo
curl https://gib.show/image/1

# PulseChain token
curl https://gib.show/image/369/0xa1077a294dde1b09bb078844df40758a5d0f9a27
```

When no image matches, the answer is a 404 status.

### Choose the format with a path extension

```
GET /image/{chainId}/{address}.{ext}
```

The extension converts the output. It works like `?as=`. Supported extensions are `png`, `webp`, `jpg`, `avif` and `svg`.

- `.svg` answers 404 when the token has no vector source. A raster image cannot become a vector image.
- An extension outside the supported set, such as `.bmp`, answers 406.

## Get a network image

```
GET /image/{chainId}
```

Returns the chain logo. It accepts the same resize options as the token route.

Two details differ from the token route:

- A path extension on this route is a **source filter**, not a conversion. `/image/eip155-369.png` serves only a `png` source. `/image/eip155-369.webp` answers 404 when no `webp` source exists. On the token route, the extension converts the output instead.
- A bare number is matched against the chain identifiers the instance actually stores. If one number is shared by two namespaces, the request can still resolve to the one that has an image.

Every success response carries an `x-resolved-chain` header. It names the identifier the request resolved to, in prefixed form (for example `eip155-369`). Use it to tell an exact match from a best guess. Algorand `ARC-25` numbers report `algorand-283`.

## Get an image by hash

```
GET /image/direct/{imageHash}
GET /image/direct/{imageHash}.{ext}
```

Direct access by image hash. It skips the priority rules. You find the hash in the `logoURI` field of list and token responses.

A bare hash serves the stored image. An extension suffix, such as `{hash}.svg`, is a source filter. The answer is 404 when the stored image is not of that type.

The hash in the path is the hash of the bytes this route serves. The bytes at one address can therefore never change. A resized or converted variant is just as fixed. For this reason the route has a one-year cache lifetime. See [Caching](/api-reference/caching/).

## Get an image with an explicit order

```
GET /image/{order}/{chainId}/{address}
```

Uses a named provider ordering, for example `default`, or an order identifier. An unknown order name silently falls back to the default ordering.

## Get an image with a fallback

```
GET /image/fallback/{order}/{chainId}/{address}
```

Tries the ordered lookup first. If that finds nothing, it falls back to any available image.

## Look up a batch of candidates

```
GET /image?i={chainId}/{address}&i={chainId}/{address}
```

Returns the first matching image from several candidates. The parameter `i` can repeat, and the first hit wins.

Each candidate has one of these forms:

- `chainId/address`.
- `chainId/address/{orderId}`, where the third segment must be a 64-character hexadecimal order identifier. Named orders such as `default` are rejected with 406.
- `chainId` alone. This serves the network logo for that chain.

An invalid candidate answers 406.

## Source filters

The token routes above accept `only`, `providerKey`, `listKey`, `license` and `mode`. See [Image options](/api-reference/image-options/).
