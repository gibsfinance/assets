---
title: Caching
description: How long each kind of response may be cached, and how to cache well.
sidebar:
  order: 12
---

## Lifetimes

| Response | `cache-control` |
|----------|-----------------|
| Images by chain and address | `public, max-age=86400`, with a seven-day `stale-while-revalidate` and `stale-if-error` window |
| `/image/direct/{imageHash}` | `public, max-age=31536000, immutable` |
| `/list/tokens/{chainId}` | `public, max-age=21600, stale-while-revalidate=86400` (6 hours fresh, 24 hours stale) |
| `/networks`, `/stats` | `public, max-age=` followed by the server's cache setting |

The server's cache setting is `CACHE_SECONDS`. It is one hour (3600) if the operator sets nothing. The published definition for `gib.show` describes one day for images. A server you host yourself uses whatever you set. See [Configuration](/self-hosting/configuration/).

Responses that an operator rebuilds with `refresh` carry `cache-control: no-store`, so no content delivery network keeps them.

## Content-addressed images

`/image/direct/{imageHash}` is content-addressed. The hash in the path is the hash of the bytes it serves, so those bytes can never change at that address. The route carries a one-year `immutable` lifetime for the original and for any resized or converted variant of it.

If you show the same set of images again and again, take the hash from the `logoURI` of a token list and request `/image/direct/{imageHash}`. Do not fetch by chain and address each time.

## Server-side variant cache

Resized variants are cached in the database. The first request for a new size costs about 50 milliseconds of resize work. Later requests for that size are fast. See [Image options](/api-reference/image-options/) for the options and [Rate limits](/api-reference/rate-limits/) for the limit on new variants.

## Reuse a small set of sizes

Each different `w`, `h` and `as` combination is a new variant. Pick a small set of sizes and reuse them. The table in [Integration examples](/api-reference/integration-examples/#recommended-sizes) lists good choices.
