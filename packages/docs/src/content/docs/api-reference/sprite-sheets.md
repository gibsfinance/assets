---
title: Sprite sheets
description: Fetch many token images for one list in a single request, as a sheet plus a JSON manifest.
sidebar:
  order: 9
---

A sprite sheet puts the images of a token list into one picture. This lets you show a long list with two requests instead of hundreds.

## Manifest

```
GET /sprite/{providerKey}/{listKey}
```

Returns a JSON manifest. It maps each token key (`chainId-address`) to its `[column, row]` position in the grid.

```bash
curl "https://gib.show/sprite/pulsex/extended?size=32&cols=10&limit=20"
```

| Parameter | Range | Default | Meaning |
|-----------|-------|---------|---------|
| `size` | 16 to 128 | 32 | Cell size in pixels. |
| `cols` | 5 to 50 | 25 | Number of grid columns. |
| `limit` | 1 to 2000 | 500 | Most tokens. |
| `content` | `mixed` | none | With `content=mixed`, vector images are inlined as data addresses in the manifest instead of being drawn on the sheet. |
| `chainId` | | none | Keep only tokens on one chain. |

The manifest fields are `spriteUrl`, `size`, `cols`, `rows`, `rasterCount`, `svgCount`, `count` and `tokens`. An unknown provider or list answers 404.

## Sheet

```
GET /sprite/{providerKey}/{listKey}/sheet
```

Returns the rendered sheet as a `webp` image. It takes the same parameters as the manifest. The response carries the headers `x-sprite-size`, `x-sprite-cols`, `x-sprite-rows`, `x-sprite-count` and `x-sprite-tokens`.

It answers 204 when the list has no raster tokens to draw.

## Licences

A sheet cannot carry one image's licence. It carries only a link to the [terms page](https://gib.show/terms). Look up each image on its own route before you rely on its licence. Sheets never include artwork from a source that forbids copies.
