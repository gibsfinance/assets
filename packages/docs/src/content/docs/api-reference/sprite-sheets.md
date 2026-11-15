---
title: Sprite sheets
description: Show the logos of one token list from a single picture, with a manifest, a stylesheet and a pinned layout version.
sidebar:
  order: 9
---

A sprite sheet puts the logos of a token list into one picture. A page can show a long list with two or three requests instead of hundreds. There are three addresses for one list. Each one names the same layout version, so they always belong together.

| Address | What it gives you |
|---------|-------------------|
| `/sprite/{providerKey}/{listKey}` | A JSON manifest. It maps each token to its place on the sheet, and names the other two addresses. |
| `/sprite/{providerKey}/{listKey}/sheet` | The sheet itself, a `webp` picture. |
| `/sprite/{providerKey}/{listKey}/sheet.css` | A stylesheet with one class per token. This is the simplest way to show a logo. |

## The stylesheet

The stylesheet is the easiest way to draw a logo. You apply two classes to an element, and the browser draws the right part of the sheet.

- The **scope class** (`gibsheet-…`) sets the box, the size and the sheet picture. Every element from one list, with the same options, shares it.
- The **token class** (`gib-<chain>-<address>`) sets the position of that token's logo.

```html
<link rel="stylesheet" href="https://gib.show/sprite/pulsex/extended/sheet.css?size=32&cols=10&limit=20">
<!-- gibsheet-… is the scope class for these same options; the software development kit computes it. -->
<span class="gibsheet-… gib-eip155-1-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" role="img" aria-label="USDC"></span>
```

The class names come from the server's own layout rules. The software development kit computes the scope class from the same options, so you do not need to ask the server for it. Give the same options to the stylesheet address and to the scope class, and they match.

Token class names keep their letter case, because some chains (Solana, for example) use case-sensitive addresses. An uppercase letter becomes an underscore and its lowercase letter, so `A` and `a` never share a class.

A stylesheet for a list that carries a vector picture under `content=mixed` gives that token its own picture, as a data address, in place of a cell.

## Manifest

```bash
curl "https://gib.show/sprite/pulsex/extended?size=32&cols=10&limit=20"
```

The manifest is JSON. It maps each token key (`chainId-address`) to its `[column, row]` cell, or to a data address for a vector under `content=mixed`.

Its fields are `spriteUrl`, `stylesheetUrl`, `version`, `size`, `scale`, `gap`, `cols`, `rows`, `rasterCount`, `svgCount`, `count`, `plate` and `tokens`. `spriteUrl` and `stylesheetUrl` both carry `v=` with the same `version`. An unknown provider or list answers 404.

## Sheet

```bash
curl -o sheet.webp "https://gib.show/sprite/pulsex/extended/sheet?size=32&cols=10&limit=20"
```

The sheet is a `webp` image. It takes the same parameters as the manifest. Its headers are `x-sprite-size`, `x-sprite-scale`, `x-sprite-gap`, `x-sprite-cols`, `x-sprite-rows`, `x-sprite-count`, `x-sprite-version` and, when they are short enough, `x-sprite-tokens`.

The sheet answers 204 when the list has no raster tokens to draw.

## Parameters

| Parameter | Range | Default | Meaning |
|-----------|-------|---------|---------|
| `size` | 16 to 128 | 32 | Cell size in CSS pixels. |
| `cols` | 5 to 50 | 25 | Number of grid columns. |
| `limit` | 1 to 2000 | 500 | Most tokens. A request with a plate is cut to 500. |
| `content` | `mixed` | none | Vector images become data addresses instead of cells on the sheet. |
| `chainId` | | none | Keep only tokens on one chain. |
| `scale` | 1 or 2 | 1 | Sheet pixels per CSS pixel. Use 2 for dense screens. Positions and sizes stay in CSS pixels. |
| `gap` | 0 to 32 | 0 | Space between cells, in CSS pixels. Scaled with the sheet. |
| `bg` | 3, 6 or 8 hex digits | none | Paint a plate of this colour behind every cell. The last two digits of eight are alpha. |
| `shape` | `circle`, `rounded`, `square` | `circle` | The outline of the plate. Used only with `bg` or `contrast`. |
| `contrast` | `dark` or `light` | none | Paint a plate only on a logo that does not stand out against your page. Use `dark` on a dark page. |
| `v` | the 14-digit `version` | none | Pin the layout you read. See versions below. |

A `gap`, `bg`, `shape` or `contrast` that is not valid answers 400, with a message that names the parameter. A `size`, `cols` or `limit` outside its range is held at the nearest limit instead, as it always was.

## Gap and scale

A gap stops neighbouring logos touching, and stops a browser that scales the sheet from drawing one logo's edge into the next. A gap of 2 or more is a good start on a page with scaled images.

The sheet has no margin at its top or left edge. It has a gap after its last column and last row. A gap of 0 gives a sheet with no space between cells.

## Plates

A plate is a coloured shape behind each logo. It is the same plate the single-image routes draw, and it uses the same rules.

- `bg` alone paints a plate on every cell.
- `contrast` alone paints a plate, in the opposite tone to your page, only on the logos that need one. It measures each logo once and remembers the answer.
- Both together use the `bg` colour, and `contrast` decides which cells get it.

A logo with nothing visible gets no plate. A plated request is cut to 500 tokens, because a plated sheet is drawn cell by cell and costs more to make. The manifest reports the plate it used.

## Versions

Every manifest carries a `version`, a 14-digit hexadecimal number. It changes when a token moves, or when the size, columns, scale, gap or plate changes. The manifest's `spriteUrl` and `stylesheetUrl` both carry it as `v=`.

Pass `v=` to the sheet or the stylesheet when you want exactly the layout you read. If the list has changed since, the answer is 409, with the current version in the body. Read the manifest again. The server never redirects you to a different layout, because a redirect would pair one layout's positions with another layout's sheet.

A cached copy of a manifest or a stylesheet can name a layout that has since changed. Its sheet then answers 409, so the logos are missing until the cache expires, but no wrong logo is ever shown.

## Capacity

A sheet has at most 16,383 pixels on each side and 25 million pixels in all. At large sizes and high scale, the sheet holds fewer cells, and the tokens past its capacity are left off the layout. The manifest's `rasterCount` says how many cells it holds.

## Budgets and refusals

Drawing a sheet takes real processing time, so the server limits it. A sheet is charged by its cells: one unit for each cell it draws without a plate, and two for each cell with one. A 500-cell sheet with a plate costs 1000 units.

- Each caller may spend 3000 units a minute. That is six unplated 500-cell sheets, or three plated ones.
- All callers together may spend 20,000 units a minute.
- Only a sheet that is actually drawn is charged. A stylesheet, a manifest, a 204 and a 409 cost nothing.

When the budget is spent, the answer is 429 with `Retry-After`, in seconds. When too many sheets are being drawn at once, the answer is 503 with a shorter `Retry-After`. Neither answer is cached. A caller who sees either should wait and try again.

## Lifetimes

| Address | Kept by caches for |
|---------|--------------------|
| Manifest | 5 minutes |
| Stylesheet | 5 minutes |
| Sheet, with no `v=` | 5 minutes |
| Sheet, with `v=` | a day |

A manifest or a stylesheet can name a layout that has since changed. Its sheet then answers 409, so logos stay missing until the cache expires, but no wrong logo is shown. A sheet pinned by `v=` keeps a day, because its version names its layout and an old sheet stays correct for any page that still holds the stylesheet that names it.

## React

The `@gibs/react` package provides a `SpriteIcon` component. It adds the stylesheet once for each address, and draws the logo.

```tsx
import { GibProvider, SpriteIcon } from '@gibs/react'

export function TokenLogo() {
  return (
    <GibProvider>
      <SpriteIcon
        provider="pulsex"
        list="extended"
        chainId="eip155-1"
        address="0xa0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
        size={24}
        scale={2}
        gap={2}
        alt="USDC"
      />
    </GibProvider>
  )
}
```

The component takes the same options as the parameter table. Without `alt`, the icon is hidden from assistive technology.

## Licences

A sheet cannot carry one image's licence. It carries only a link to the terms page of the instance. The public instance publishes it at [gib.show/terms](https://gib.show/terms). Look up each image on its own route before you rely on its licence. Sheets never include artwork from a source that forbids copies.
