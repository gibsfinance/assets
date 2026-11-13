/**
 * @module image/resize
 * On-the-fly image resize and format conversion using sharp.
 *
 * `maybeResize()` is the entry point — handlers parse `?w=`, `?h=`, `?as=` (and any
 * path-extension format) once via `parseResizeParams` and pass the result in. It then
 * looks up cached variants in `image_variant` table, or creates new ones via sharp pipeline.
 * Per-image and global rate limits prevent cache pollution from enumeration attacks.
 * SVGs with viewBox are served as-is unless explicit format conversion is requested, with
 * their fixed width and height stripped so a browser scales them from the viewBox alone.
 * `cacheControlFor()` picks between the two cache lifetimes the service serves: a year-long,
 * immutable lifetime for content-addressed responses (`/image/direct/{imageHash}`, where the
 * address is derived from the content it names) and the shorter, configured lifetime everywhere
 * else, where the same address can later answer with different bytes.
 */
import sharp from 'sharp'
import type { FormatEnum, Sharp } from 'sharp'
import type { Response } from 'express'
import httpErrors from 'http-errors'
import type { Image, ImageVariant, InsertableImageVariant } from '../../db/schema-types'
import * as db from '../../db'
import config from '../../../config'
import { imageMode } from '../../db/tables'
import { failureLog } from '@gibs/utils'
import { attributionHeaders } from './attribution'
import { createRateLimiter } from './rate-limit'
import { isLinkOnlyHost } from '../../link-only-hosts'
import {
  LUMINANCE_SAMPLE_SIDE,
  type Plate,
  type PlateRequest,
  createLuminanceCache,
  computePlateSide,
  measureVisibleLuminance,
  parsePlateRequest,
  plateInnerSide,
  renderPlatedRaster,
  resolvePlate,
  wrapSvgWithPlate,
} from './plate'

// ---------------------------------------------------------------------------
// Section 1: Query param parsing, SVG detection, format helpers
// ---------------------------------------------------------------------------

/** Allowed output formats */
const VALID_FORMATS = new Set(['webp', 'png', 'jpg', 'jpeg', 'avif'])

/**
 * A name that looks like an output format but cannot be produced by conversion.
 * svg is vector, sharp only rasterizes, so "convert to svg" has no honest
 * answer. The old published API guide never told
 * anyone to ask for it, so this is not a deprecated-alias case — it is a
 * request that must fail loudly instead of silently serving the original
 * bytes back under a 200.
 */
const UNCONVERTIBLE_FORMATS = new Set(['svg'])

/** Stored extensions that mean the image is already a vector. */
const SVG_SOURCE_EXTS = new Set(['.svg', '.svg+xml'])

/** Max dimension to prevent abuse */
const MAX_DIM = 2048

/** Resolution at which sharp rasterizes a vector image when no density is given. */
const SVG_BASE_DENSITY = 72

/** Highest density sharp accepts. */
const SVG_MAX_DENSITY = 100000

/**
 * Longest side, in pixels, a vector image may be rasterized to before it is
 * fitted to the requested size. It is the same bound `parseResizeParams` puts
 * on a requested side. Bounding the drawing's long side, not only the request,
 * matters for a narrow image asked for by width alone: it would otherwise be
 * drawn thousands of pixels tall, past what memory or the WebP format allow.
 */
const SVG_MAX_RASTER_SIDE = MAX_DIM

/**
 * The two cache lifetimes this service serves. `content-addressed` names a
 * route whose address is derived from its own content — `/image/direct/{hash}` —
 * so the bytes behind that address can never change and a year-long,
 * `immutable` cache is honest. Every other route names a mutable address (a
 * token or chain can get a new image at the same address later), so it keeps
 * the shorter, configured lifetime instead.
 */
export type CachePolicy = 'content-addressed' | 'mutable'

/** One year in seconds — the lifetime a content-addressed response is cached for. */
const CONTENT_ADDRESSED_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/**
 * How long a cache may keep serving a mutable image after it expires, in seconds.
 *
 * The image at a token address rarely changes, and a stale icon for a few days is
 * acceptable. Without this window every icon became a cache miss once a day, and a
 * miss costs 280 to 370 ms against 90 to 150 ms for a hit. With it, the first request
 * after expiry still gets the cached copy at hit speed while the cache refreshes in the
 * background. The same window covers `stale-if-error`, so an origin outage does not
 * blank icons the cache already holds.
 */
const MUTABLE_STALE_SECONDS = 60 * 60 * 24 * 7

/** Build the `cache-control` header value for one of the two cache lifetimes this service serves. */
export function cacheControlFor(policy: CachePolicy): string {
  if (policy === 'content-addressed') return `public, max-age=${CONTENT_ADDRESSED_MAX_AGE_SECONDS}, immutable`
  return `public, max-age=${config.cacheSeconds}, stale-while-revalidate=${MUTABLE_STALE_SECONDS}, stale-if-error=${MUTABLE_STALE_SECONDS}`
}

export interface ResizeParams {
  w: number | null
  h: number | null
  format: string | null
  /**
   * A requested output format that sharp cannot produce — `svg` today. Recorded
   * rather than rejected at parse time, because whether it is satisfiable depends
   * on the source: an svg source already IS the requested format. Resolved in
   * `maybeResize`, which is the first place the stored image is in hand.
   */
  unconvertibleFormat: string | null
  /**
   * A plate to paint behind the logo (`?bg=`, `?contrast=`, `?shape=`, see `./plate`). Absent when
   * neither `bg` nor `contrast` was given. Whether it is painted can depend on the logo itself,
   * so `maybeResize` settles that.
   */
  plate?: PlateRequest
}

export interface ResizeParamsInput {
  /** Express request query (?w=, ?h=, ?as=, or the deprecated ?format=) */
  query: Record<string, unknown>
  /** Output extension from the URL path (e.g. '.webp'); applies when ?as= and ?format= are both absent */
  pathExt?: string | null
}

/**
 * Parse and validate output format and dimensions from the query string and
 * optional path extension. Handlers call this once and pass the result into
 * `maybeResize` — Express 5 re-parses `req.query` on every access, so writing
 * a derived format back into it is silently discarded.
 *
 * `?format=` is a deprecated alias for `?as=` — the old published API guide
 * published `format` as the parameter name before the code ever implemented
 * it, so requests written against that guide are honoured rather than
 * silently ignored. `?as=` wins when both are present.
 *
 * A query value that names svg specifically (as opposed to any other
 * unrecognised value) throws a 404 naming the problem — see
 * UNCONVERTIBLE_FORMATS. A path-extension svg request never reaches here as
 * an unconvertible target: it is validated upstream against the actual
 * source format before parseResizeParams is called, so a `pathExt` of
 * '.svg' at this point already named a real SVG source.
 */
export function parseResizeParams({ query, pathExt }: ResizeParamsInput): ResizeParams | null {
  const wRaw = typeof query.w === 'string' ? parseInt(query.w, 10) : NaN
  const hRaw = typeof query.h === 'string' ? parseInt(query.h, 10) : NaN
  const asFormat = typeof query.as === 'string' ? query.as.toLowerCase() : null
  const deprecatedFormat = typeof query.format === 'string' ? query.format.toLowerCase() : null
  const queryFormat = asFormat ?? deprecatedFormat

  // A request for a vector output is recorded, not decided, here: whether it can
  // be honoured depends on the SOURCE, which this function never sees. Asking for
  // svg when the stored image already IS an svg is a perfectly satisfiable
  // request and answers 200 today; only a raster source makes it impossible.
  // Throwing here would have turned that working request into a 404.
  const unconvertibleFormat = queryFormat && UNCONVERTIBLE_FORMATS.has(queryFormat) ? queryFormat : null

  const fRaw = queryFormat ?? (pathExt ? pathExt.replace('.', '').toLowerCase() : null)

  const w = !isNaN(wRaw) && wRaw >= 1 && wRaw <= MAX_DIM ? wRaw : null
  const h = !isNaN(hRaw) && hRaw >= 1 && hRaw <= MAX_DIM ? hRaw : null
  const format = fRaw && VALID_FORMATS.has(fRaw) ? (fRaw === 'jpeg' ? 'jpg' : fRaw) : null

  // Parsed before the early return: a plate request alone is enough to need `maybeResize`, and an
  // invalid one must answer 400 even when nothing else was asked for.
  const plate = parsePlateRequest(query)
  if (!w && !h && !format && !unconvertibleFormat && !plate) return null
  return { w, h, format, unconvertibleFormat, ...(plate ? { plate } : {}) }
}

/** Check if SVG content has a viewBox attribute */
export function svgHasViewBox(content: Buffer): boolean {
  const str = content.toString('utf8', 0, Math.min(content.length, 4096))
  return /viewBox=/i.test(str)
}

/**
 * The document's root `<svg>` opening tag, with its start and end offsets in
 * the source string. Nested elements can never be mistaken for it: none of
 * them exist before the root tag's own closing `>`, so the first `<svg` up to
 * the first `>` that follows it is always the root, however deep the document
 * nests other elements afterward.
 */
function extractRootSvgTag(document: string): { tag: string; start: number; end: number } | null {
  const start = document.indexOf('<svg')
  if (start === -1) return null
  const end = document.indexOf('>', start)
  if (end === -1) return null
  return { tag: document.slice(start, end + 1), start, end }
}

/**
 * Strip the `width` and `height` attributes from the root `<svg>` element,
 * but only when it also carries a `viewBox`. A `viewBox` alone already lets a
 * browser scale the image, so a fixed width and height on the root forces
 * every consumer styling it with cascading style sheets to override or strip
 * them first. Without a `viewBox`, the width and height are the only record
 * of the image's intrinsic size, so removing them would collapse the image
 * instead — that case is left untouched.
 *
 * Only the isolated root-element substring returned by `extractRootSvgTag` is
 * ever rewritten, never the whole document, so a `width` or `height`
 * belonging to a nested element (an inner `<rect>`, `<image>`, ...) is never
 * touched.
 */
export function stripRootSvgDimensions(content: Buffer): Buffer {
  const document = content.toString('utf8')
  const root = extractRootSvgTag(document)
  if (!root) return content
  if (!svgHasViewBox(Buffer.from(root.tag, 'utf8'))) return content

  const strippedTag = root.tag
    .replace(/\s+width="[^"]*"/, '')
    .replace(/\s+width='[^']*'/, '')
    .replace(/\s+height="[^"]*"/, '')
    .replace(/\s+height='[^']*'/, '')
  if (strippedTag === root.tag) return content

  return Buffer.from(document.slice(0, root.start) + strippedTag + document.slice(root.end + 1), 'utf8')
}

/**
 * How much larger than its intrinsic size a vector image must be rasterized so
 * that fitting it inside `w` by `h` needs no enlargement. A raster scales up
 * badly, but a vector can be drawn at any size, so it is drawn at the size
 * asked for. Never below 1: a request smaller than the image is met by the
 * ordinary resize, and the image is not drawn larger than it needs to be.
 * The result is capped so the drawn long side stays within `SVG_MAX_RASTER_SIDE`.
 */
export function computeSvgScale({
  intrinsic,
  target,
}: {
  intrinsic: { width?: number; height?: number }
  target: { w: number | null; h: number | null }
}): number {
  const { width, height } = intrinsic
  if (!width || !height) return 1
  const ratios = [target.w ? target.w / width : null, target.h ? target.h / height : null].filter(
    (ratio): ratio is number => ratio !== null,
  )
  if (ratios.length === 0) return 1
  const wanted = Math.min(...ratios)
  const sideLimit = SVG_MAX_RASTER_SIDE / Math.max(width, height)
  return Math.max(1, Math.min(wanted, sideLimit))
}

/**
 * The density to hand sharp for a vector image drawn `scale` times larger than
 * its intrinsic size. Rounded up so the drawing is never a pixel short of the
 * target, and held to the highest density sharp accepts.
 */
export function densityForScale(scale: number): number {
  return Math.min(SVG_MAX_DENSITY, Math.ceil(SVG_BASE_DENSITY * scale))
}

/**
 * Open image bytes with sharp. A vector source is rasterized large enough to
 * reach the requested size (see `computeSvgScale`); any other source is opened
 * as it is.
 */
export async function openSource({
  content,
  ext,
  target,
}: {
  content: Buffer
  ext: string
  target: { w: number | null; h: number | null }
}): Promise<Sharp> {
  if (!SVG_SOURCE_EXTS.has(ext)) return sharp(content)
  if (!target.w && !target.h) return sharp(content)
  const intrinsic = await sharp(content).metadata()
  const scale = computeSvgScale({ intrinsic, target })
  if (scale === 1) return sharp(content)
  return sharp(content, { density: densityForScale(scale) })
}

/** Map format string to content-type */
export function formatToContentType(format: string): string {
  switch (format) {
    case 'webp':
      return 'image/webp'
    case 'png':
      return 'image/png'
    case 'jpg':
      return 'image/jpeg'
    case 'avif':
      return 'image/avif'
    case 'svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream'
  }
}

/** Map file extension to sharp format name */
export function extToFormat(ext: string): string {
  const clean = ext.replace('.', '').toLowerCase()
  if (clean === 'jpg' || clean === 'jpeg') return 'jpeg'
  if (clean === 'svg' || clean === 'svg+xml') return 'png'
  if (['webp', 'png', 'avif'].includes(clean)) return clean
  return 'png'
}

/** Map user-facing format param to sharp format name. Sharp uses 'jpeg' not 'jpg'. */
export function normalizeFormat(format: string): string {
  return format === 'jpg' ? 'jpeg' : format
}

// ---------------------------------------------------------------------------
// Section 2: Rate limiter
// ---------------------------------------------------------------------------

/**
 * The limiter the image route spends from. One instance per process, holding
 * the production budgets and the wall clock.
 *
 * Anything that needs its own counters — a test, or a second route with a
 * different budget — builds one with `createRateLimiter` rather than reaching
 * for this one.
 */
const variantRateLimiter = createRateLimiter()

/** Record one variant request for `imageHash`. False when a budget is spent. */
export function checkRateLimit(imageHash: string): boolean {
  return variantRateLimiter.check(imageHash)
}

/**
 * Forget every window in the shared limiter.
 *
 * A test that exercises the image route spends from the same budget as every
 * test before it. Calling this first is what makes a test answer for its own
 * requests rather than for the ones the file above it happened to make.
 */
export function resetRateLimit(): void {
  variantRateLimiter.reset()
}

// ---------------------------------------------------------------------------
// Section 3: Main maybeResize function + sendVariant
// ---------------------------------------------------------------------------

export interface MaybeResizeOptions {
  res: Response
  img: Image & {
    providerKey?: string
    /** The list_token row's precomputed effective licence, when a list_token is known. */
    license?: string | null
    listLicense?: string | null
    listLicenseUrl?: string | null
    listAttribution?: string | null
  }
  /** Pre-parsed resize/format options from `parseResizeParams`; null = no resize requested */
  params: ResizeParams | null
  /** Which of the two cache lifetimes a served variant gets. Defaults to `mutable`. */
  cachePolicy?: CachePolicy
}

/**
 * Attempt to serve a resized/transcoded variant of the image.
 * Returns true if a variant was served, false if caller should use default sendImage.
 * Takes pre-parsed params instead of reading `req.query` so path-extension
 * conversion and query conversion flow through one explicit code path.
 */
export async function maybeResize({ res, img, params, cachePolicy = 'mutable' }: MaybeResizeOptions): Promise<boolean> {
  if (!params) return false

  // Now that the source is known, settle a request for a format sharp cannot
  // produce. An svg source already satisfies `?as=svg`, so serve it unchanged;
  // a raster source cannot become one, and saying so beats handing back a png
  // that the caller asked not to receive.
  const isSvgSource = SVG_SOURCE_EXTS.has(img.ext)
  if (params.unconvertibleFormat && !isSvgSource) {
    throw httpErrors.NotFound(
      `${params.unconvertibleFormat} is not available for this image — its source is ${img.ext.replace('.', '')}, and a raster image cannot be converted to a vector one`,
    )
  }
  // With a plate the svg still has work to do: it is wrapped and sent as svg.
  if (params.unconvertibleFormat && !params.plate) return false

  const { w, h, format } = params
  const targetFormat = format || extToFormat(img.ext)

  // For LINK-mode images, fetch the remote content
  let content = img.content
  if (img.mode === imageMode.LINK && (!content || content.length === 0)) {
    if (!img.uri || !img.uri.startsWith('http')) return false
    // A link-only host's terms forbid a copy as much as a derivative, and a
    // resize or a format conversion is a derivative. Fetching the bytes here
    // just to transcode them would be exactly what storage already refuses to
    // do — so this returns false the same way an unfetchable image does, and
    // the caller falls through to sendImage, which redirects to the address
    // honestly instead of serving a converted copy of it.
    if (isLinkOnlyHost(img.uri)) return false
    try {
      const fetchRes = await fetch(img.uri, { signal: AbortSignal.timeout(5000) })
      if (!fetchRes.ok) return false
      content = Buffer.from(await fetchRes.arrayBuffer())
    } catch {
      return false
    }
  }

  // No bytes to convert: the image's file is missing from the image store (already logged by
  // `loadImageBytes`), or a save-mode row holds none. Let the caller redirect or answer 404.
  if (!content || content.length === 0) return false

  // A plate is never stored as a variant (see `servePlated`), so it is settled before the variant
  // cache is consulted. No plate needed and nothing else asked for: the original is served.
  const plate = params.plate ? await settlePlate({ request: params.plate, img, content }) : null
  if (plate) return servePlated({ res, img, content, plate, params, cachePolicy })
  if (!w && !h && !format) return false

  // SVG with viewBox and no explicit format conversion → serve as-is
  if (SVG_SOURCE_EXTS.has(img.ext)) {
    if (svgHasViewBox(content) && !format) return false
  }

  // Build the variant key — use 0 as sentinel for "original size" when format-only
  let targetW = w
  let targetH = h
  if (!targetW && !targetH) {
    targetW = 0
    targetH = 0
  }

  // Check for cached variant
  const existing = await db.getVariant(img.imageHash, targetW || 0, targetH || 0, targetFormat)
  if (existing) {
    db.bumpVariantAccess(img.imageHash, targetW || 0, targetH || 0, targetFormat).catch((e: Error) =>
      failureLog('variant op failed: %s', e.message),
    )
    sendVariant(res, existing, {
      uri: img.uri,
      providerKey: img.providerKey,
      entryLicense: img.license,
      listLicense: img.listLicense,
      listLicenseUrl: img.listLicenseUrl,
      listAttribution: img.listAttribution,
      cachePolicy,
    })
    return true
  }

  // Cache miss — resize with sharp
  let pipeline = await openSource({ content, ext: img.ext, target: { w: targetW, h: targetH } })

  if (targetW || targetH) {
    pipeline = pipeline.resize(targetW || undefined, targetH || undefined, {
      fit: 'inside',
      // Nothing is enlarged here. A vector source was already drawn at the
      // requested size by `openSource`, so it needs no enlargement; leaving the
      // flag on also stops sharp from drawing it larger than the pixel budget
      // `SVG_MAX_RASTER_SIDE` allows. A raster source is never enlarged.
      withoutEnlargement: true,
    })
  }

  pipeline = pipeline.toFormat(normalizeFormat(targetFormat) as keyof FormatEnum | 'avif')

  const resizedBuffer = await pipeline.toBuffer()

  const variantRecord: InsertableImageVariant = {
    imageHash: img.imageHash,
    width: targetW || 0,
    height: targetH || 0,
    format: targetFormat,
    content: resizedBuffer,
  }

  // Persist if under rate limit
  if (checkRateLimit(img.imageHash)) {
    db.insertVariant(variantRecord).catch((e: Error) => failureLog('variant op failed: %s', e.message))
  }

  sendVariant(
    res,
    {
      ...variantRecord,
      accessCount: 1,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    },
    {
      uri: img.uri,
      providerKey: img.providerKey,
      entryLicense: img.license,
      listLicense: img.listLicense,
      listLicenseUrl: img.listLicenseUrl,
      listAttribution: img.listAttribution,
      cachePolicy,
    },
  )

  return true
}

/**
 * Measured luminance by image, so a logo is drawn small and measured once and not on every request
 * that says `contrast=`. Keyed by the image's own hash.
 */
const luminanceCache = createLuminanceCache()

/** Decide whether this request gets a plate, measuring the logo only when `contrast` needs it. */
async function settlePlate({
  request,
  img,
  content,
}: {
  request: PlateRequest
  img: Pick<Image, 'imageHash' | 'ext'>
  content: Buffer
}): Promise<Plate | null> {
  const measure = async () =>
    measureVisibleLuminance(
      await openSource({ content, ext: img.ext, target: { w: LUMINANCE_SAMPLE_SIDE, h: LUMINANCE_SAMPLE_SIDE } }),
    )
  return resolvePlate({
    request,
    measureLuminance: () => luminanceCache.remember(img.imageHash, measure),
  })
}

/**
 * Serve a logo on a plate. A vector source with a `viewBox`, and no `as`, stays a vector: the plate
 * is drawn behind the original, nested whole. Anything else is drawn to pixels, at the requested
 * size (or its own size), in the requested format or the source's.
 *
 * A plated image is not stored in `image_variant`. That table is keyed by size and format, so a
 * plated copy would be served to a plain request. Extending the key would need a migration, and
 * the cost here is one small draw per request, while the edge cache holds the answer by its full
 * address, query included. The `ETag` Express adds comes from the body, so it differs with the plate.
 */
async function servePlated({
  res,
  img,
  content,
  plate,
  params,
  cachePolicy,
}: {
  res: Response
  img: MaybeResizeOptions['img']
  content: Buffer
  plate: Plate
  params: ResizeParams
  cachePolicy: CachePolicy
}): Promise<true> {
  const { w, h, format } = params
  const isVector = SVG_SOURCE_EXTS.has(img.ext)
  const wrapped = isVector && !format ? wrapSvgWithPlate({ content, plate }) : null
  const targetFormat = format || extToFormat(img.ext)
  const pixels = wrapped
    ? null
    : await drawPlatedPixels({ content, ext: img.ext, plate, target: { w, h }, format: targetFormat })
  const now = new Date().toISOString()
  sendVariant(
    res,
    {
      imageHash: img.imageHash,
      width: pixels?.side ?? 0,
      height: pixels?.side ?? 0,
      format: wrapped ? 'svg' : targetFormat,
      content: wrapped ?? pixels!.body,
      accessCount: 1,
      createdAt: now,
      lastAccessedAt: now,
    },
    {
      uri: img.uri,
      providerKey: img.providerKey,
      entryLicense: img.license,
      listLicense: img.listLicense,
      listLicenseUrl: img.listLicenseUrl,
      listAttribution: img.listAttribution,
      cachePolicy,
    },
  )
  return true
}

/** Draw a logo on a plate as pixels; returns the bytes and the side of the square they were drawn at. */
async function drawPlatedPixels({
  content,
  ext,
  plate,
  target,
  format,
}: {
  content: Buffer
  ext: string
  plate: Plate
  target: { w: number | null; h: number | null }
  format: string
}): Promise<{ body: Buffer; side: number }> {
  const side = computePlateSide({
    target,
    intrinsic: await sharp(content).metadata(),
    isVector: SVG_SOURCE_EXTS.has(ext),
    shape: plate.shape,
  })
  const inner = plateInnerSide({ side, shape: plate.shape })
  const logo = await openSource({ content, ext, target: { w: inner, h: inner } })
  const body = await renderPlatedRaster({ logo, side, plate, format: normalizeFormat(format) })
  return { body, side }
}

export interface SendVariantOptions {
  /** The source uri the original image was read from, if any. */
  uri?: string | null
  /** The provider key recorded on the original image row, if any. */
  providerKey?: string | null
  /** The list_token row's precomputed effective licence, when a list_token is known. */
  entryLicense?: string | null
  /** The owning list's own registered licence, for url/attribution enrichment. */
  listLicense?: string | null
  listLicenseUrl?: string | null
  listAttribution?: string | null
  /** Which of the two cache lifetimes this response gets. Defaults to `mutable`. */
  cachePolicy?: CachePolicy
}

/**
 * Send a resized/transcoded image variant, with the same attribution headers a
 * full-size `sendImage()` response carries. A relative submodule path used to be
 * silently dropped here — the check below only matched `http`/`ipfs` uris, so
 * every resized network icon served from a submodule lost its attribution even
 * though the unresized original still carried it. Routing both through the same
 * `attributionHeaders()` helper as `sendImage()` is what keeps that from
 * happening again.
 */
export function sendVariant(
  res: Response,
  variant: ImageVariant,
  {
    uri,
    providerKey,
    entryLicense,
    listLicense,
    listLicenseUrl,
    listAttribution,
    cachePolicy = 'mutable',
  }: SendVariantOptions = {},
): void {
  let r = res.set('cache-control', cacheControlFor(cachePolicy))
  r = r.set('x-resize', variant.width && variant.height ? `${variant.width}x${variant.height}` : 'transcoded')
  const headers = attributionHeaders({ uri, providerKey, entryLicense, listLicense, listLicenseUrl, listAttribution })
  for (const [name, value] of Object.entries(headers)) {
    r = r.set(name, value)
  }
  r.contentType(formatToContentType(variant.format)).send(variant.content)
}
