import sharp from 'sharp'
import * as db from '../../db'
import { tableNames } from '../../db/tables'
import config from '../../../config'
import { RequestHandler } from 'express'
import type { Image } from 'knex/types/tables'

const DEFAULT_SIZE = 32
const DEFAULT_COLS = 25
const MAX_TOKENS = 1000

interface SpriteToken {
  address: string
  imageHash: string
  content: Buffer
  ext: string
  mode: string
  uri: string
}

/**
 * Rasterize a single image to the target size.
 * Handles SVGs, PNGs, JPGs, WebPs — normalizes everything to PNG pixels.
 */
async function rasterize(image: SpriteToken, size: number): Promise<Buffer | null> {
  try {
    if (image.mode === 'link' || !image.content || image.content.length === 0) {
      // LINK-mode: fetch remote content
      if (!image.uri) return null
      const res = await fetch(image.uri, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      return sharp(buf).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    }
    return sharp(image.content)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
  } catch {
    return null
  }
}

/**
 * GET /image/sprite/:chainId
 * Returns JSON manifest with token positions and sprite sheet URL.
 *
 * ?content=mixed — SVGs returned as inline data URIs, rasters in the sprite grid.
 *                  Keeps SVGs resolution-independent instead of rasterizing them.
 * (default)     — all tokens in the sprite grid (SVGs rasterized).
 */
export const manifest: RequestHandler = async (req, res) => {
  const chainId = req.params.chainId
  const size = Math.min(Math.max(Number(req.query.size) || DEFAULT_SIZE, 16), 128)
  const cols = Math.min(Math.max(Number(req.query.cols) || DEFAULT_COLS, 5), 50)
  const limit = Math.min(Number(req.query.limit) || 500, MAX_TOKENS)
  const mixed = req.query.content === 'mixed'

  // Get all tokens for this chain with their images (+ content for SVG extraction)
  const selectFields = [
    `${tableNames.token}.provided_id as address`,
    `${tableNames.image}.image_hash`,
    `${tableNames.image}.ext`,
  ]
  if (mixed) {
    selectFields.push(`${tableNames.image}.content`)
  }

  const tokens = await db.getDB()
    .select(selectFields)
    .from(tableNames.listToken)
    .join(tableNames.token, { [`${tableNames.token}.tokenId`]: `${tableNames.listToken}.tokenId` })
    .join(tableNames.network, { [`${tableNames.network}.networkId`]: `${tableNames.token}.networkId` })
    .join(tableNames.image, { [`${tableNames.image}.imageHash`]: `${tableNames.listToken}.imageHash` })
    .where(`${tableNames.network}.chainId`, chainId)
    .whereNot(`${tableNames.image}.imageHash`, '')
    .groupBy(...selectFields)
    .orderByRaw(`CASE WHEN ${tableNames.image}.ext = '.svg' THEN 0 ELSE 1 END ASC`)
    .limit(limit) as Array<{ address: string; image_hash: string; ext: string; content?: Buffer }>

  // Deduplicate by address (first wins — SVGs preferred due to ordering)
  const seen = new Set<string>()

  // In mixed mode: SVGs go inline, rasters go in the sprite grid
  const tokenMap: Record<string, [number, number] | string> = {}
  let rasterIdx = 0

  for (const t of tokens) {
    const addr = t.address.toLowerCase()
    if (seen.has(addr)) continue
    seen.add(addr)

    if (mixed && t.ext === '.svg' && t.content && t.content.length > 0) {
      // Inline SVG as data URI
      const b64 = t.content.toString('base64')
      tokenMap[addr] = `data:image/svg+xml;base64,${b64}`
    } else {
      // Raster → sprite grid position
      tokenMap[addr] = [rasterIdx % cols, Math.floor(rasterIdx / cols)]
      rasterIdx++
    }
  }

  const rows = Math.ceil(rasterIdx / cols)
  const spriteParams = `size=${size}&cols=${cols}&limit=${limit}${mixed ? '&content=mixed' : ''}`

  res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  res.json({
    spriteUrl: `/image/sprite/${chainId}/sheet?${spriteParams}`,
    size,
    cols,
    rows,
    rasterCount: rasterIdx,
    svgCount: seen.size - rasterIdx,
    count: seen.size,
    tokens: tokenMap,
  })
}

/**
 * GET /image/sprite/:chainId/sheet
 * Returns the actual sprite sheet image (WebP).
 */
export const sheet: RequestHandler = async (req, res) => {
  const chainId = req.params.chainId
  const size = Math.min(Math.max(Number(req.query.size) || DEFAULT_SIZE, 16), 128)
  const cols = Math.min(Math.max(Number(req.query.cols) || DEFAULT_COLS, 5), 50)
  const limit = Math.min(Number(req.query.limit) || 500, MAX_TOKENS)
  const mixed = req.query.content === 'mixed'

  // Get all tokens with image content
  const tokens = await db.getDB()
    .select([
      `${tableNames.token}.provided_id as address`,
      `${tableNames.image}.content`,
      `${tableNames.image}.ext`,
      `${tableNames.image}.mode`,
      `${tableNames.image}.uri`,
      `${tableNames.image}.image_hash`,
    ])
    .from(tableNames.listToken)
    .join(tableNames.token, { [`${tableNames.token}.tokenId`]: `${tableNames.listToken}.tokenId` })
    .join(tableNames.network, { [`${tableNames.network}.networkId`]: `${tableNames.token}.networkId` })
    .join(tableNames.image, { [`${tableNames.image}.imageHash`]: `${tableNames.listToken}.imageHash` })
    .where(`${tableNames.network}.chainId`, chainId)
    .whereNot(`${tableNames.image}.imageHash`, '')
    .groupBy(
      `${tableNames.token}.provided_id`,
      `${tableNames.image}.content`,
      `${tableNames.image}.ext`,
      `${tableNames.image}.mode`,
      `${tableNames.image}.uri`,
      `${tableNames.image}.image_hash`,
    )
    .orderByRaw(`CASE WHEN ${tableNames.image}.ext = '.svg' THEN 0 ELSE 1 END ASC`)
    .limit(limit) as SpriteToken[]

  // Deduplicate by address; in mixed mode, skip SVGs (served inline via manifest)
  const seen = new Set<string>()
  const deduped: SpriteToken[] = []
  for (const t of tokens) {
    const addr = t.address.toLowerCase()
    if (seen.has(addr)) continue
    seen.add(addr)
    if (mixed && t.ext === '.svg') continue
    deduped.push(t)
  }

  const rows = Math.ceil(deduped.length / cols)
  const width = cols * size
  const height = rows * size

  // Rasterize all icons in parallel (batched to avoid memory pressure)
  const composites: sharp.OverlayOptions[] = []
  const batchSize = 20
  for (let i = 0; i < deduped.length; i += batchSize) {
    const batch = deduped.slice(i, i + batchSize)
    const results = await Promise.all(
      batch.map(async (token, batchIdx) => {
        const idx = i + batchIdx
        const buf = await rasterize(token, size)
        if (!buf) return null
        return {
          input: buf,
          left: (idx % cols) * size,
          top: Math.floor(idx / cols) * size,
        }
      }),
    )
    for (const r of results) {
      if (r) composites.push(r)
    }
  }

  // Build position manifest (address → [col, row])
  const tokenMap: Record<string, [number, number]> = {}
  for (let i = 0; i < deduped.length; i++) {
    tokenMap[deduped[i].address.toLowerCase()] = [i % cols, Math.floor(i / cols)]
  }

  // Compose the sprite sheet
  const sprite = await sharp({
    create: {
      width: Math.max(width, 1),
      height: Math.max(height, 1),
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp({ quality: 85 })
    .toBuffer()

  // Encode manifest in headers so the client gets image + positions in one request
  res.set('content-type', 'image/webp')
  res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  res.set('x-sprite-size', String(size))
  res.set('x-sprite-cols', String(cols))
  res.set('x-sprite-rows', String(rows))
  res.set('x-sprite-count', String(deduped.length))
  res.set('x-sprite-tokens', JSON.stringify(tokenMap))
  res.set('access-control-expose-headers', 'x-sprite-size, x-sprite-cols, x-sprite-rows, x-sprite-count, x-sprite-tokens')
  res.send(sprite)
}
