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
 * address is the hash of the bytes it names) and the shorter, configured lifetime everywhere
 * else, where the same address can later answer with different bytes.
 */
import sharp from 'sharp'
import type { FormatEnum } from 'sharp'
import type { Response } from 'express'
import httpErrors from 'http-errors'
import type { Image, ImageVariant, InsertableImageVariant } from '../../db/schema-types'
import * as db from '../../db'
import config from '../../../config'
import { imageMode } from '../../db/tables'
import { failureLog } from '@gibs/utils'
import { attributionHeaders } from './attribution'

// ---------------------------------------------------------------------------
// Section 1: Query param parsing, SVG detection, format helpers
// ---------------------------------------------------------------------------

/** Allowed output formats */
const VALID_FORMATS = new Set(['webp', 'png', 'jpg', 'jpeg', 'avif'])

/**
 * A name that looks like an output format but cannot be produced by conversion.
 * svg is vector, sharp only rasterizes, so "convert to svg" has no honest
 * answer. The old published guide (docs/skills/api-reference.md) never told
 * anyone to ask for it, so this is not a deprecated-alias case — it is a
 * request that must fail loudly instead of silently serving the original
 * bytes back under a 200.
 */
const UNCONVERTIBLE_FORMATS = new Set(['svg'])

/** Max dimension to prevent abuse */
const MAX_DIM = 2048

/**
 * The two cache lifetimes this service serves. `content-addressed` names a
 * route whose address is the hash of its own bytes — `/image/direct/{hash}` —
 * so the bytes behind that address can never change and a year-long,
 * `immutable` cache is honest. Every other route names a mutable address (a
 * token or chain can get a new image at the same address later), so it keeps
 * the shorter, configured lifetime instead.
 */
export type CachePolicy = 'content-addressed' | 'mutable'

/** One year in seconds — the lifetime a content-addressed response is cached for. */
const CONTENT_ADDRESSED_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/** Build the `cache-control` header value for one of the two cache lifetimes this service serves. */
export function cacheControlFor(policy: CachePolicy): string {
  if (policy === 'content-addressed') return `public, max-age=${CONTENT_ADDRESSED_MAX_AGE_SECONDS}, immutable`
  return `public, max-age=${config.cacheSeconds}`
}

export interface ResizeParams {
  w: number | null
  h: number | null
  format: string | null
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
 * `?format=` is a deprecated alias for `?as=` — docs/skills/api-reference.md
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

  if (queryFormat && UNCONVERTIBLE_FORMATS.has(queryFormat)) {
    throw httpErrors.NotFound(`${queryFormat} is not a convertible output format — request an svg source directly`)
  }

  const fRaw = queryFormat ?? (pathExt ? pathExt.replace('.', '').toLowerCase() : null)

  const w = !isNaN(wRaw) && wRaw >= 1 && wRaw <= MAX_DIM ? wRaw : null
  const h = !isNaN(hRaw) && hRaw >= 1 && hRaw <= MAX_DIM ? hRaw : null
  const format = fRaw && VALID_FORMATS.has(fRaw) ? (fRaw === 'jpeg' ? 'jpg' : fRaw) : null

  if (!w && !h && !format) return null
  return { w, h, format }
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

const PER_IMAGE_LIMIT = 5
const GLOBAL_LIMIT = 100
const WINDOW_MS = 60_000

interface RateWindow {
  count: number
  windowStart: number
}

const perImageWindows = new Map<string, RateWindow>()
let globalWindow: RateWindow = { count: 0, windowStart: Date.now() }

function cleanExpiredWindows(): void {
  const now = Date.now()
  for (const [key, win] of perImageWindows) {
    if (now - win.windowStart > WINDOW_MS) {
      perImageWindows.delete(key)
    }
  }
}

export function checkRateLimit(imageHash: string): boolean {
  const now = Date.now()

  if (now - globalWindow.windowStart > WINDOW_MS) {
    globalWindow = { count: 0, windowStart: now }
  }
  if (globalWindow.count >= GLOBAL_LIMIT) return false

  let win = perImageWindows.get(imageHash)
  if (!win || now - win.windowStart > WINDOW_MS) {
    win = { count: 0, windowStart: now }
    perImageWindows.set(imageHash, win)
  }
  if (win.count >= PER_IMAGE_LIMIT) return false

  win.count++
  globalWindow.count++

  if (perImageWindows.size > 1000) cleanExpiredWindows()

  return true
}

// ---------------------------------------------------------------------------
// Section 3: Main maybeResize function + sendVariant
// ---------------------------------------------------------------------------

export interface MaybeResizeOptions {
  res: Response
  img: Image & { providerKey?: string }
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

  const { w, h, format } = params
  const targetFormat = format || extToFormat(img.ext)

  // For LINK-mode images, fetch the remote content
  let content = img.content
  if (img.mode === imageMode.LINK && (!content || content.length === 0)) {
    if (!img.uri || !img.uri.startsWith('http')) return false
    try {
      const fetchRes = await fetch(img.uri, { signal: AbortSignal.timeout(5000) })
      if (!fetchRes.ok) return false
      content = Buffer.from(await fetchRes.arrayBuffer())
    } catch {
      return false
    }
  }

  // SVG with viewBox and no explicit format conversion → serve as-is
  if (img.ext === '.svg' || img.ext === '.svg+xml') {
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
    sendVariant(res, existing, { uri: img.uri, providerKey: img.providerKey, cachePolicy })
    return true
  }

  // Cache miss — resize with sharp
  let pipeline = sharp(content)

  if (targetW || targetH) {
    pipeline = pipeline.resize(targetW || undefined, targetH || undefined, {
      fit: 'inside',
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
    { uri: img.uri, providerKey: img.providerKey, cachePolicy },
  )

  return true
}

export interface SendVariantOptions {
  /** The source uri the original image was read from, if any. */
  uri?: string | null
  /** The provider key recorded on the original image row, if any. */
  providerKey?: string | null
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
  { uri, providerKey, cachePolicy = 'mutable' }: SendVariantOptions = {},
): void {
  let r = res.set('cache-control', cacheControlFor(cachePolicy))
  r = r.set('x-resize', variant.width && variant.height ? `${variant.width}x${variant.height}` : 'transcoded')
  const headers = attributionHeaders({ uri, providerKey })
  for (const [name, value] of Object.entries(headers)) {
    r = r.set(name, value)
  }
  r.contentType(formatToContentType(variant.format)).send(variant.content)
}
