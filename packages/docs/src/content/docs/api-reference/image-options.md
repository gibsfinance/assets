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
| `as` | string | original format | Output format: `webp`, `png`, `jpg`, `jpeg` or `avif`. `svg` succeeds only when the stored image already is a vector image. Against a raster source it answers 404. Any other value is ignored, and Gib serves the original format. |
| `format` | string | none | A deprecated alias for `as`. An earlier version of the documentation used this name. When both are present, `as` wins. |
| `only` | `vector` or `raster` | none | Keep only source images of this type, before Gib chooses one. |
| `providerKey` | string | none | Use only these providers, for example `trustwallet` or `coingecko`. Separate several with commas. |
| `listKey` | string | none | Use only these list keys. Separate several with commas. |
| `license` | string | none | Allow only images with these licences. See [Ask for licensed artwork only](#ask-for-licensed-artwork-only). |
| `bg` | hex colour | none | Paint a plate behind the logo. See [Put a logo on a plate](#put-a-logo-on-a-plate). |
| `shape` | `circle`, `rounded` or `square` | `circle` | The outline of the plate. |
| `contrast` | `dark` or `light` | none | Add a plate only when the logo is hard to see on a dark or light page. |
| `mode` | `link` | none | With `mode=link`, Gib answers 302 and redirects to the original source address instead of sending the image. Without it, Gib sends the image bytes. |

## How resizing works

- `w` alone resizes in proportion.
- `h` alone resizes in proportion.
- `w` and `h` together fit the image inside those bounds and keep the aspect ratio.
- Gib never enlarges an image. If the source is smaller than you asked for, you get the original.
- A vector image (`svg`) that has a `viewBox` passes through unchanged. It is already independent of resolution.
- A vector image without a `viewBox` is rasterised to `png`.
- `as` without `w` or `h` converts the format and keeps the original size.

## Put a logo on a plate

Some logos are dark and almost vanish on a dark page. Add a plate, a solid shape behind the logo, to fix that. Three parameters control it. They work on every image route.

- `bg` is the plate colour. Write 3, 6 or 8 hex digits without `#`. Eight digits end with alpha, so `00000080` is half-transparent black. Any other value answers 400.
- `shape` is the outline: `circle` (the default), `rounded` or `square`. It has an effect only together with `bg` or `contrast`. On its own it is checked, so a typo still answers 400, and then ignored.
- `contrast` tells Gib what your page looks like: `dark` or `light`. Gib measures how bright the logo is and compares it with a typical page of that tone. It adds a plate in the opposite tone (white on a dark page, near-black on a light page) only when the contrast ratio is under 3:1, the minimum the Web Content Accessibility Guidelines set for graphics. A logo that already stands out is served unchanged.

When you send `bg` and `contrast` together, `bg` is the plate colour and `contrast` decides whether the plate appears. With `bg` alone the plate is always drawn.

```bash
# Add a light plate only if the logo is too dark for a dark page
curl "https://gib.show/image/25?contrast=dark"

# Always paint a white rounded plate
curl "https://gib.show/image/25?bg=ffffff&shape=rounded"

# A plate drawn to pixels, 128 by 128, as webp
curl "https://gib.show/image/25?bg=ffffff&as=webp&w=128"
```

How the plate is drawn:

- A vector image with a `viewBox` stays a vector. The answer is `image/svg+xml`: a new image with the plate behind and the original inside it, centred. Gib adds nothing from your query to it except the validated colour. `w` and `h` have no effect on a vector, as before.
- Any other source, or any request with `as`, is drawn to pixels. The plate is a square, `w` by `w` (or the smaller of `w` and `h`). Without a size, a vector source is drawn 256 pixels wide and a raster source keeps its size plus room for the padding. The logo is fitted inside the shape with space around it, more for `circle` than for `square`, and is never enlarged. A circle or rounded plate has transparent corners, except in `jpg`, which has no transparency and gets white corners.
- A vector without a `viewBox` is drawn to pixels as `png`, because it has no size to nest it by.
- Gib does not store plated images, and a plated request never receives a plain image or the other way round. The response `ETag` follows the bytes, and the logo's brightness is measured once and remembered by the server.
- A source that asks that its artwork is not copied is redirected, as described above. It gets no plate.

## Response headers

| Header | Meaning |
|--------|---------|
| `x-resize` | `original` when no resize was applied. `WxH` (for example `72x72`) when the image was resized to those dimensions. `transcoded` when only the format changed. |
| `x-source-uri` | The address of the original source file. |
| `x-uri` | The same value as `x-source-uri`. It is kept for older callers. |
| `x-provider` | The key of the collector that supplied the image. |
| `x-provider-name` | The display name of that provider. |
| `x-license` | The licence Gib identified, or `unknown`. |
| `x-license-url` | Where to read that licence. Sent only when the licence is known. |
| `x-attribution` | The notice you must reproduce, when the licence requires one. |
| `link` | A link to the licence terms page of the instance. On the public instance it is `https://gib.show/terms`. |
| `x-resolved-chain` | Network image route only. The prefixed identifier the request resolved to. |
| `cache-control` | See [Caching](/api-reference/caching/). |

`link` and `x-license` are always present. The other provenance headers appear when the information is known. Browser code can read them across origins.

When a source asks that its artwork is not copied, Gib stores only the address and answers with a redirect to the source. Those responses carry the same provenance headers. A resize or a format change is also a copy, so for these sources `w`, `h` and `as` have no effect: you get the redirect.

Read the terms page of the instance you use for what you must do with each licence. The public instance publishes them at [gib.show/terms](https://gib.show/terms). A licence on a file is not a licence to a trademark.

## Ask for licensed artwork only

Add `license` to any token or chain image route to receive only artwork under licences you accept. The value is matched without regard to case. Repeat the parameter or separate values with commas:

```bash
curl "https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?license=MIT&license=Apache-2.0"
curl "https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?license=MIT,Apache-2.0"
```

When you send `license`:

- Only images whose **effective licence** is in your set are candidates. The effective licence is the one on the list entry itself, checked against where the image actually lives. It is never a provider's licence by default.
- Gib serves the best-ranked image among those candidates. You do not get a miss just because a higher-ranked image was unlicensed.
- A licence that Gib has not verified is `unknown`. Unknown is never treated as permitted, so it never matches.
- When no candidate qualifies, you get the ordinary 404 answer for the route. You never get an unlicensed image.

## Sprite sheets

A sprite sheet combines many images from many sources, so it cannot carry one image's licence. It carries only the link to the terms page. See [Sprite sheets](/api-reference/sprite-sheets/).
