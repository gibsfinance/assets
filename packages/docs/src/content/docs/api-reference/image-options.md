---
title: Image options
description: Query parameters that resize, convert and filter images, and the headers every image response carries.
sidebar:
  order: 3
---

These options apply to the token image routes. The resize and format options also work on the network image route and on `/image/direct/{imageHash}`.

## Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `w` | integer, 1 to 2048 | none | Target width in pixels. |
| `h` | integer, 1 to 2048 | none | Target height in pixels. |
| `as` | string | original format | Output format: `webp`, `png`, `jpg`, `jpeg` or `avif`. `svg` succeeds only when the stored image already is a vector image. Against a raster source it answers 404. Any other value is ignored, and Gib.Show serves the original format. |
| `format` | string | none | A deprecated alias for `as`. An earlier version of the documentation used this name. When both are present, `as` wins. |
| `only` | `vector` or `raster` | none | Keep only source images of this type, before Gib.Show chooses one. |
| `providerKey` | string | none | Use only these providers, for example `trustwallet` or `coingecko`. Separate several with commas. |
| `listKey` | string | none | Use only these list keys. Separate several with commas. |
| `license` | string | none | Allow only images with these licences. See [Ask for licensed artwork only](#ask-for-licensed-artwork-only). |
| `mode` | `link` | none | With `mode=link`, Gib.Show answers 302 and redirects to the original source address instead of sending the image. Without it, Gib.Show sends the image bytes. |

## How resizing works

- `w` alone resizes in proportion.
- `h` alone resizes in proportion.
- `w` and `h` together fit the image inside those bounds and keep the aspect ratio.
- Gib.Show never enlarges an image. If the source is smaller than you asked for, you get the original.
- A vector image (`svg`) that has a `viewBox` passes through unchanged. It is already independent of resolution.
- A vector image without a `viewBox` is rasterised to `png`.
- `as` without `w` or `h` converts the format and keeps the original size.

## Response headers

| Header | Meaning |
|--------|---------|
| `x-resize` | `original` when no resize was applied. `WxH` (for example `72x72`) when the image was resized to those dimensions. `transcoded` when only the format changed. |
| `x-source-uri` | The address of the original source file. |
| `x-uri` | The same value as `x-source-uri`. It is kept for older callers. |
| `x-provider` | The key of the collector that supplied the image. |
| `x-provider-name` | The display name of that provider. |
| `x-license` | The licence Gib.Show identified, or `unknown`. |
| `x-license-url` | Where to read that licence. Sent only when the licence is known. |
| `x-attribution` | The notice you must reproduce, when the licence requires one. |
| `link` | A link to the licence terms page, `https://gib.show/terms`. |
| `x-resolved-chain` | Network image route only. The prefixed identifier the request resolved to. |
| `cache-control` | See [Caching](/api-reference/caching/). |

`link` and `x-license` are always present. The other provenance headers appear when the information is known. Browser code can read them across origins.

When a source asks that its artwork is not copied, Gib.Show stores only the address and answers with a redirect to the source. Those responses carry the same provenance headers. A resize or a format change is also a copy, so for these sources `w`, `h` and `as` have no effect: you get the redirect.

Read [gib.show/terms](https://gib.show/terms) for what you must do with each licence. A licence on a file is not a licence to a trademark.

## Ask for licensed artwork only

Add `license` to any token or chain image route to receive only artwork under licences you accept. The value is matched without regard to case. Repeat the parameter or separate values with commas:

```bash
curl "https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?license=MIT&license=Apache-2.0"
curl "https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?license=MIT,Apache-2.0"
```

When you send `license`:

- Only images whose **effective licence** is in your set are candidates. The effective licence is the one on the list entry itself, checked against where the image actually lives. It is never a provider's licence by default.
- Gib.Show serves the best-ranked image among those candidates. You do not get a miss just because a higher-ranked image was unlicensed.
- A licence that Gib.Show has not verified is `unknown`. Unknown is never treated as permitted, so it never matches.
- When no candidate qualifies, you get the ordinary 404 answer for the route. You never get an unlicensed image.

## Sprite sheets

A sprite sheet combines many images from many sources, so it cannot carry one image's licence. It carries only the link to the terms page. See [Sprite sheets](/api-reference/sprite-sheets/).
