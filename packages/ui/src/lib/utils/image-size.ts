/**
 * @module image-size
 * Right-size requests to the gib.show image endpoint.
 *
 * The endpoint serves whatever bytes were collected upstream unless `?w=`/`?h=`/`?as=`
 * ask for something smaller. Nothing in the interface asked, so a 24-pixel row icon
 * pulled the full stored asset — a 47 KB PulseChain logo where 1.5 KB renders
 * identically, and worse for the heaviest entries. Sizing lives here rather than at
 * each call site so a new `<Image>` cannot silently reintroduce the full-resolution
 * request.
 */

/**
 * Requested dimensions are snapped to these before they reach the server.
 *
 * The server caches one variant per (image, width, height, format). Passing each
 * call site's exact pixel size would scatter near-identical variants across the
 * cache and, because variant writes are rate limited, leave most of them never
 * persisted — every page load would re-run the resize. A short shared ladder keeps
 * unrelated surfaces asking for the same handful of variants.
 */
export const SIZE_BUCKETS = [32, 48, 64, 96, 128, 192, 256] as const

const LARGEST_BUCKET = SIZE_BUCKETS[SIZE_BUCKETS.length - 1]

/** Request twice the layout size so icons stay sharp on high-density displays. */
const DENSITY_MULTIPLIER = 2

/** Query params that mean the caller has already stated what it wants. */
const EXPLICIT_PARAMS = ['w', 'h', 'as'] as const

/**
 * Snap a layout size in CSS pixels to the bucket that renders it sharply.
 *
 * @param cssPixels - The size the image occupies in the layout.
 * @returns The width/height to request from the server.
 */
export function toSizeBucket(cssPixels: number): number {
  const target = Math.ceil(cssPixels * DENSITY_MULTIPLIER)
  return SIZE_BUCKETS.find((bucket) => bucket >= target) ?? LARGEST_BUCKET
}

/**
 * Add width, height, and format params to a gib.show image URL.
 *
 * Left untouched: URLs pointing anywhere else (upstream `logoURI` values, data and
 * blob URIs) and URLs that already carry an explicit `w`, `h`, or `as` — a caller
 * that stated its own size, such as the token image manager's per-size previews,
 * outranks the default.
 *
 * @param url - The image URL as built by the call site.
 * @param width - Layout width in CSS pixels.
 * @param height - Layout height in CSS pixels.
 * @param imageEndpoint - Prefix identifying our own image endpoint, e.g. `https://gib.show/image/`.
 * @returns The URL to fetch.
 */
export function sizedImageUrl({
  url,
  width,
  height,
  imageEndpoint,
}: {
  url: string
  width: number
  height: number
  imageEndpoint: string
}): string {
  if (!url.startsWith(imageEndpoint)) return url

  const separatorIndex = url.indexOf('?')
  const path = separatorIndex === -1 ? url : url.slice(0, separatorIndex)
  const params = new URLSearchParams(separatorIndex === -1 ? '' : url.slice(separatorIndex + 1))
  if (EXPLICIT_PARAMS.some((param) => params.has(param))) return url

  params.set('w', String(toSizeBucket(width)))
  params.set('h', String(toSizeBucket(height)))
  params.set('as', 'webp')
  return `${path}?${params.toString()}`
}
