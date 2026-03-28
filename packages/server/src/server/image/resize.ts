import sharp from 'sharp'
import type { Request, Response } from 'express'
import type { Image, ImageVariant, InsertableImageVariant } from '../../db/schema-types'
import * as db from '../../db'
import config from '../../../config'
import { imageMode } from '../../db/tables'

// ---------------------------------------------------------------------------
// Section 1: Query param parsing, SVG detection, format helpers
// ---------------------------------------------------------------------------

/** Allowed output formats */
const VALID_FORMATS = new Set(['webp', 'png', 'jpg', 'jpeg', 'avif'])

/** Max dimension to prevent abuse */
const MAX_DIM = 2048

export interface ResizeParams {
  w: number | null
  h: number | null
  format: string | null
}

/** Parse and validate w/h/as from Express query string */
export function parseResizeParams(query: Request['query']): ResizeParams | null {
  const wRaw = typeof query.w === 'string' ? parseInt(query.w, 10) : NaN
  const hRaw = typeof query.h === 'string' ? parseInt(query.h, 10) : NaN
  const fRaw = typeof query.as === 'string' ? query.as.toLowerCase() : null

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

/** Map format string to content-type */
export function formatToContentType(format: string): string {
  switch (format) {
    case 'webp': return 'image/webp'
    case 'png': return 'image/png'
    case 'jpg': return 'image/jpeg'
    case 'avif': return 'image/avif'
    default: return 'application/octet-stream'
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

/**
 * Attempt to serve a resized/transcoded variant of the image.
 * Returns true if a variant was served, false if caller should use default sendImage.
 */
export async function maybeResize(
  req: Request,
  res: Response,
  img: Image,
): Promise<boolean> {
  const params = parseResizeParams(req.query)
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
    db.bumpVariantAccess(img.imageHash, targetW || 0, targetH || 0, targetFormat).catch(() => {})
    sendVariant(res, existing, img.uri)
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

  pipeline = pipeline.toFormat(normalizeFormat(targetFormat) as keyof sharp.FormatEnum)

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
    db.insertVariant(variantRecord).catch(() => {})
  }

  sendVariant(res, {
    ...variantRecord,
    accessCount: 1,
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
  }, img.uri)

  return true
}

export function sendVariant(res: Response, variant: ImageVariant, uri?: string): void {
  let r = res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  r = r.set('x-resize', variant.width && variant.height
    ? `${variant.width}x${variant.height}`
    : 'transcoded')
  if (uri) {
    if (uri.startsWith('http') || uri.startsWith('ipfs')) {
      r = r.set('x-uri', uri)
    }
  }
  r.contentType(formatToContentType(variant.format)).send(variant.content)
}
