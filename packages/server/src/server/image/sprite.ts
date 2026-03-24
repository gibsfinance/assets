import sharp from 'sharp'
import * as db from '../../db'
import { tableNames } from '../../db/tables'
import config from '../../../config'
import { RequestHandler } from 'express'

const DEFAULT_SIZE = 32
const DEFAULT_COLS = 25
const MAX_TOKENS = 2000

interface SpriteToken {
  address: string
  imageHash: string
  content: Buffer
  ext: string
  mode: string
  uri: string
}

async function rasterize(image: SpriteToken, size: number): Promise<Buffer | null> {
  try {
    let buf: Buffer
    if (image.mode === 'link' || !image.content || image.content.length === 0) {
      if (!image.uri) return null
      const res = await fetch(image.uri, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return null
      buf = Buffer.from(await res.arrayBuffer())
    } else {
      buf = image.content
    }
    return sharp(buf)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
  } catch {
    return null
  }
}

/** Resolve a list to its DB listId from provider/key path params */
async function resolveListId(providerKey: string, listKey: string): Promise<string | null> {
  const list = await db.getDB()
    .select('list.listId')
    .from(tableNames.list)
    .join(tableNames.provider, { [`${tableNames.provider}.providerId`]: `${tableNames.list}.providerId` })
    .where(`${tableNames.provider}.key`, providerKey)
    .where(`${tableNames.list}.key`, listKey || providerKey)
    .first()
  return list?.listId ?? null
}

/** Query tokens under a list with their images */
function queryListTokens(listId: string, fields: string[]) {
  return db.getDB()
    .select(fields)
    .from(tableNames.listToken)
    .join(tableNames.token, { [`${tableNames.token}.tokenId`]: `${tableNames.listToken}.tokenId` })
    .join(tableNames.network, { [`${tableNames.network}.networkId`]: `${tableNames.token}.networkId` })
    .join(tableNames.image, { [`${tableNames.image}.imageHash`]: `${tableNames.listToken}.imageHash` })
    .where(`${tableNames.listToken}.listId`, listId)
    .whereNot(`${tableNames.image}.imageHash`, '')
    .orderByRaw(`CASE WHEN ${tableNames.image}.ext = '.svg' THEN 0 ELSE 1 END ASC`)
}

// ---------------------------------------------------------------------------
// Manifest: GET /image/sprite/:providerKey/:listKey
// ---------------------------------------------------------------------------

/**
 * Returns JSON manifest for a list's sprite sheet.
 *
 * ?content=mixed — SVGs returned as inline data URIs, rasters in sprite grid.
 * (default)     — all tokens in the sprite grid.
 * ?chainId=N    — filter to a specific chain within the list.
 */
export const manifest: RequestHandler = async (req, res, next) => {
  const { providerKey, listKey } = req.params
  const listId = await resolveListId(providerKey, listKey)
  if (!listId) return next()

  const size = Math.min(Math.max(Number(req.query.size) || DEFAULT_SIZE, 16), 128)
  const cols = Math.min(Math.max(Number(req.query.cols) || DEFAULT_COLS, 5), 50)
  const limit = Math.min(Number(req.query.limit) || 500, MAX_TOKENS)
  const mixed = req.query.content === 'mixed'
  const chainFilter = req.query.chainId ? String(req.query.chainId) : null

  const fields = [
    `${tableNames.token}.provided_id as address`,
    `${tableNames.network}.chain_id as chainId`,
    `${tableNames.image}.image_hash`,
    `${tableNames.image}.ext`,
  ]
  if (mixed) fields.push(`${tableNames.image}.content`)

  let q = queryListTokens(listId, fields)
  if (chainFilter) q = q.where(`${tableNames.network}.chainId`, chainFilter)

  const tokens = await q.limit(limit) as Array<{
    address: string; chainId: string; image_hash: string; ext: string; content?: Buffer
  }>

  const seen = new Set<string>()
  const tokenMap: Record<string, [number, number] | string> = {}
  let rasterIdx = 0

  for (const t of tokens) {
    const key = `${t.chainId}-${t.address.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)

    if (mixed && t.ext === '.svg' && t.content && t.content.length > 0) {
      tokenMap[key] = `data:image/svg+xml;base64,${t.content.toString('base64')}`
    } else {
      tokenMap[key] = [rasterIdx % cols, Math.floor(rasterIdx / cols)]
      rasterIdx++
    }
  }

  const rows = Math.ceil(rasterIdx / cols)
  const params = new URLSearchParams({
    size: String(size), cols: String(cols), limit: String(limit),
    ...(mixed ? { content: 'mixed' } : {}),
    ...(chainFilter ? { chainId: chainFilter } : {}),
  })

  res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  res.json({
    spriteUrl: `/sprite/${providerKey}/${listKey}/sheet?${params}`,
    size,
    cols,
    rows,
    rasterCount: rasterIdx,
    svgCount: seen.size - rasterIdx,
    count: seen.size,
    tokens: tokenMap,
  })
}

// ---------------------------------------------------------------------------
// Sheet: GET /image/sprite/:providerKey/:listKey/sheet
// ---------------------------------------------------------------------------

export const sheet: RequestHandler = async (req, res, next) => {
  const { providerKey, listKey } = req.params
  const listId = await resolveListId(providerKey, listKey)
  if (!listId) return next()

  const size = Math.min(Math.max(Number(req.query.size) || DEFAULT_SIZE, 16), 128)
  const cols = Math.min(Math.max(Number(req.query.cols) || DEFAULT_COLS, 5), 50)
  const limit = Math.min(Number(req.query.limit) || 500, MAX_TOKENS)
  const mixed = req.query.content === 'mixed'
  const chainFilter = req.query.chainId ? String(req.query.chainId) : null

  const fields = [
    `${tableNames.token}.provided_id as address`,
    `${tableNames.image}.content`,
    `${tableNames.image}.ext`,
    `${tableNames.image}.mode`,
    `${tableNames.image}.uri`,
    `${tableNames.image}.image_hash`,
  ]

  let q = queryListTokens(listId, fields)
  if (chainFilter) q = q.where(`${tableNames.network}.chainId`, chainFilter)

  const tokens = await q.limit(limit) as SpriteToken[]

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
  const height = Math.max(rows * size, 1)

  // Rasterize in parallel batches
  const composites: sharp.OverlayOptions[] = []
  const batchSize = 20
  for (let i = 0; i < deduped.length; i += batchSize) {
    const batch = deduped.slice(i, i + batchSize)
    const results = await Promise.all(
      batch.map(async (token, batchIdx) => {
        const idx = i + batchIdx
        const buf = await rasterize(token, size)
        if (!buf) return null
        return { input: buf, left: (idx % cols) * size, top: Math.floor(idx / cols) * size }
      }),
    )
    for (const r of results) {
      if (r) composites.push(r)
    }
  }

  // Build position manifest for headers
  const tokenMap: Record<string, [number, number]> = {}
  for (let i = 0; i < deduped.length; i++) {
    tokenMap[deduped[i].address.toLowerCase()] = [i % cols, Math.floor(i / cols)]
  }

  const sprite = await sharp({
    create: { width: Math.max(width, 1), height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .webp({ quality: 85 })
    .toBuffer()

  res.set('content-type', 'image/webp')
  res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  // Grid metadata in headers (small, always fits)
  res.set('x-sprite-size', String(size))
  res.set('x-sprite-cols', String(cols))
  res.set('x-sprite-rows', String(rows))
  res.set('x-sprite-count', String(deduped.length))
  // Token map can exceed header size limits — use the manifest endpoint instead.
  // Only include in header if small enough (<4KB to stay under proxy limits).
  const tokenJson = JSON.stringify(tokenMap)
  if (tokenJson.length < 4096) {
    res.set('x-sprite-tokens', tokenJson)
  }
  res.set('access-control-expose-headers', 'x-sprite-size, x-sprite-cols, x-sprite-rows, x-sprite-count, x-sprite-tokens')
  res.send(sprite)
}
