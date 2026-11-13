---
title: Image serving
description: How the server finds, chooses, resizes, labels and sends an image.
sidebar:
  order: 6
---

This page explains the code behind the [image endpoints](/api-reference/images/). The public behaviour is on the [Image options](/api-reference/image-options/) and [Image priority](/api-reference/image-priority/) pages.

## The pipeline

The routes live in `packages/server/src/server/image/`. `index.ts` registers them in this order, from the most specific to the least:

1. `/direct/:imageHash`
2. `/fallback/:order/:chainId/:address`
3. `/:order/:chainId/:address`
4. `/:chainId/:address`
5. `/:chainId` (the network image)
6. `/` (the batch lookup)

Query options:

- `?as=webp` converts the output format. The `sharp` resize pipeline does it.
- `?only=vector` filters the source type. The filter works on the extension, before selection. It applies to the token routes, the network route (`/:chainId`) and the batch lookup. With `?only=vector` the answer is an SVG source or a 404, never a raster image. A network keeps one icon, so the network route answers 404 when that icon is not a vector.
- A path extension such as `.webp` on the address does the same as `?as=webp`.

`handlers.ts` holds the routes and the format checks. `resize.ts` holds the resize pipeline and the variant cache. `rate-limit.ts` holds the limiter for new variants. `attribution.ts` decides the licence headers. `headers.ts` names shared headers such as `x-resolved-chain`.

## Choosing an image

The choice comes from one rule, `listEntryPreferenceSql()` in `db/index.ts`. In order, it prefers:

1. The image tier. A stored usable image comes first. A usable image on a link-only host such as DeBank comes next (the host set is `LINK_ONLY_HOSTS`). No image comes last.
2. Provider ranking, as `ranking / 1000`.
3. Format.
4. Version, newest first.
5. The default flag.
6. The list key.

There is one rule for the by-address image (`applyOrder`), for the chain lists and for search. A `logoURI` therefore names the image that `/image/:chainId/:address` serves.

`applyOrder` adds one term right after the usable image: a current list version beats a superseded one. The lists read current versions only, so without that term, a higher-ranked provider's superseded entry would win the image route while the list named a current entry. The two routes would then serve different images for one token. It is a ranking term, not a filter. A token that only a superseded version still carries keeps its image.

`RANKING_SPACING = 1000` in `sync-order.ts` groups sub-lists under their providers. That is why the rule compares `ranking / 1000`.

## Reading the bytes

See [Image store internals](/contributing/image-store/#image-bytes-the-store-and-the-database). The short version: never select `image.content` directly. Use `withImageBytes` or `loadImageBytes`, and keep `res.contentType(ext).send(buffer)` so the ETag and 304 answers stay identical.

## Resizing and variants

- `w` and `h` are limited to 1 to 2048 (`MAX_DIM`).
- A vector image with a `viewBox` and no format change is served as it is.
- A link-only host's terms forbid a copy as much as a derivative, and a resize or a format change is a derivative. For such an image the resize code returns false, and the caller redirects to the source address. Fetching the bytes only to convert them would be exactly what storage already refuses to do.
- After resizing, the code stores the variant in `image_variant` only if the rate limiter allows it. The response is sent either way.
- A daily job (`pruneVariants`) removes variants with fewer than 3 accesses in 24 hours, and then resets the access counts.

## Provenance headers

`attribution.ts` is the single place that decides which source produced a served image and what attribution that source needs. `sendImage` and `sendVariant` both use it, so they cannot disagree.

- The licence belongs to the **list**, not to the provider. One provider can publish many lists under different terms. A list that only points at someone else's image cannot grant a licence to it.
- The effective licence of one entry's image is decided once, at collection time, by `effectiveEntryLicense`. It uses the list's own licence and the `ownArtwork` location recorded on each registry entry.
- A source with no verified licence is marked `unknown`. It is never guessed, because a guessed licence is worse than none.
- Every registry entry was filled in by opening the named source's own licence file and copying its real copyright line.
- `ATTRIBUTION_HEADER_NAMES` is the exact set of headers the cross-origin configuration must expose.

## Caching headers

`resize.ts` builds `cache-control`:

- Content-addressed responses (`/image/direct/...`) get `public, max-age=31536000, immutable`.
- Other responses get `public, max-age=<cache seconds>, stale-while-revalidate=<seven days>, stale-if-error=<seven days>`.

See [Caching](/api-reference/caching/).
