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
 */
export const manifest: RequestHandler = async (req, res) => {
  const chainId = req.params.chainId
  const size = Math.min(Math.max(Number(req.query.size) || DEFAULT_SIZE, 16), 128)
  const cols = Math.min(Math.max(Number(req.query.cols) || DEFAULT_COLS, 5), 50)
  const limit = Math.min(Number(req.query.limit) || 500, MAX_TOKENS)

  // Get all tokens for this chain with their images
  const tokens = await db.getDB()
    .select([
      `${tableNames.token}.provided_id as address`,
      `${tableNames.image}.image_hash`,
      `${tableNames.image}.ext`,
    ])
    .from(tableNames.listToken)
    .join(tableNames.token, { [`${tableNames.token}.tokenId`]: `${tableNames.listToken}.tokenId` })
    .join(tableNames.network, { [`${tableNames.network}.networkId`]: `${tableNames.token}.networkId` })
    .join(tableNames.image, { [`${tableNames.image}.imageHash`]: `${tableNames.listToken}.imageHash` })
    .where(`${tableNames.network}.chainId`, chainId)
    .whereNot(`${tableNames.image}.imageHash`, '')
    .groupBy(`${tableNames.token}.provided_id`, `${tableNames.image}.image_hash`, `${tableNames.image}.ext`)
    .orderByRaw(`CASE WHEN ${tableNames.image}.ext = '.svg' THEN 0 ELSE 1 END ASC`)
    .limit(limit) as Array<{ address: string; image_hash: string; ext: string }>

  // Deduplicate by address (first wins — SVGs preferred due to ordering)
  const seen = new Set<string>()
  const deduped: Array<{ address: string; col: number; row: number }> = []
  for (const t of tokens) {
    const addr = t.address.toLowerCase()
    if (seen.has(addr)) continue
    seen.add(addr)
    const idx = deduped.length
    deduped.push({ address: addr, col: idx % cols, row: Math.floor(idx / cols) })
  }

  const rows = Math.ceil(deduped.length / cols)
  const tokenMap: Record<string, [number, number]> = {}
  for (const t of deduped) {
    tokenMap[t.address] = [t.col, t.row]
  }

  res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  res.json({
    spriteUrl: `/image/sprite/${chainId}/sheet?size=${size}&cols=${cols}&limit=${limit}`,
    size,
    cols,
    rows,
    count: deduped.length,
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

  // Deduplicate by address
  const seen = new Set<string>()
  const deduped: SpriteToken[] = []
  for (const t of tokens) {
    const addr = t.address.toLowerCase()
    if (seen.has(addr)) continue
    seen.add(addr)
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
