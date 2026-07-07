import sharp from 'sharp'
import config from '../../../config'
import { RequestHandler } from 'express'
import { getDrizzle } from '../../db/drizzle'
import { eq, and, ne, sql as dsql } from 'drizzle-orm'
import * as s from '../../db/schema'
import { normalizeProvidedId } from '../../db/provided-id'

const DEFAULT_SIZE = 32
const DEFAULT_COLS = 25
const MAX_TOKENS = 2000

interface SpriteToken {
  address: string
  chainId: string
  imageHash: string
  content: Buffer
  ext: string
  mode: string
  uri: string
}

/**
 * Grid key shared by the manifest and the sheet — chain-qualified so a list
 * carrying the same address on several chains keeps one cell per chain and
 * both endpoints agree on coordinates.
 */
export function spriteKey(token: { chainId: string; address: string }): string {
  // normalizeProvidedId lowercases only hex addresses; base58 ids (Solana, Tron) are
  // case-significant and preserved. The key is exposed verbatim in the manifest's
  // `tokens` map, so a bare .toLowerCase() would both collide distinct base58 mints
  // in the grid and hand consumers a corrupted address.
  return `${token.chainId}-${normalizeProvidedId(token.address)}`
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
  const drizzle = getDrizzle()
  const [row] = await drizzle
    .select({ listId: s.list.listId })
    .from(s.list)
    .innerJoin(s.provider, eq(s.provider.providerId, s.list.providerId))
    .where(and(eq(s.provider.key, providerKey), eq(s.list.key, listKey || providerKey)))
    .limit(1)
  return row?.listId ?? null
}

/** Query tokens under a list with their images */
function queryListTokens(listId: string) {
  return getDrizzle()
    .select({
      address: s.token.providedId,
      chainId: s.network.chainId,
      imageHash: s.image.imageHash,
      ext: s.image.ext,
      content: s.image.content,
      mode: s.image.mode,
      uri: s.image.uri,
    })
    .from(s.listToken)
    .innerJoin(s.token, eq(s.token.tokenId, s.listToken.tokenId))
    .innerJoin(s.network, eq(s.network.networkId, s.token.networkId))
    .innerJoin(s.image, eq(s.image.imageHash, s.listToken.imageHash))
    .where(and(eq(s.listToken.listId, listId), ne(s.image.imageHash, '')))
    .orderBy(
      dsql`CASE WHEN ${s.image.ext} IN ('.svg', '.svg+xml') THEN 0 WHEN ${s.image.ext} = '.webp' THEN 1 ELSE 2 END ASC`,
    )
    .$dynamic()
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
export const manifest: RequestHandler = async (req, res, _next) => {
  const { providerKey, listKey } = req.params
  const listId = await resolveListId(providerKey, listKey)
  // Respond with the documented JSON Error shape — `next()` here fell through
  // to the framework's HTML 404, breaking JSON consumers.
  if (!listId) {
    res.status(404).json({ error: 'unknown provider or list' })
    return
  }

  const size = Math.min(Math.max(Number(req.query.size) || DEFAULT_SIZE, 16), 128)
  const cols = Math.min(Math.max(Number(req.query.cols) || DEFAULT_COLS, 5), 50)
  const limit = Math.min(Number(req.query.limit) || 500, MAX_TOKENS)
  const mixed = req.query.content === 'mixed'
  const chainFilter = req.query.chainId ? String(req.query.chainId) : null

  let q = queryListTokens(listId)
  if (chainFilter) q = q.where(eq(s.network.chainId, chainFilter))

  const tokens = await q.limit(limit)

  const seen = new Set<string>()
  const tokenMap: Record<string, [number, number] | string> = {}
  let rasterIdx = 0

  for (const t of tokens) {
    const key = spriteKey({ chainId: String(t.chainId), address: t.address as string })
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
    size: String(size),
    cols: String(cols),
    limit: String(limit),
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

export const sheet: RequestHandler = async (req, res, _next) => {
  const { providerKey, listKey } = req.params
  const listId = await resolveListId(providerKey, listKey)
  // Same JSON 404 as the manifest — see the comment there.
  if (!listId) {
    res.status(404).json({ error: 'unknown provider or list' })
    return
  }

  const size = Math.min(Math.max(Number(req.query.size) || DEFAULT_SIZE, 16), 128)
  const cols = Math.min(Math.max(Number(req.query.cols) || DEFAULT_COLS, 5), 50)
  const limit = Math.min(Number(req.query.limit) || 500, MAX_TOKENS)
  const mixed = req.query.content === 'mixed'
  const chainFilter = req.query.chainId ? String(req.query.chainId) : null

  let q = queryListTokens(listId)
  if (chainFilter) q = q.where(eq(s.network.chainId, chainFilter))

  const tokens = (await q.limit(limit)) as unknown as SpriteToken[]

  const seen = new Set<string>()
  const deduped: SpriteToken[] = []
  for (const t of tokens) {
    // Dedupe by the same chain-qualified key as the manifest — bare-address
    // dedupe dropped same-address tokens on other chains, drifting every grid
    // coordinate after the collision relative to the manifest.
    const key = spriteKey(t)
    if (seen.has(key)) continue
    seen.add(key)
    if (mixed && t.ext === '.svg') continue
    deduped.push(t)
  }

  if (deduped.length === 0) {
    res.status(204).end()
    return
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

  // Build position manifest for headers — keyed identically to the manifest endpoint
  const tokenMap: Record<string, [number, number]> = {}
  for (let i = 0; i < deduped.length; i++) {
    tokenMap[spriteKey(deduped[i])] = [i % cols, Math.floor(i / cols)]
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
  res.set(
    'access-control-expose-headers',
    'x-sprite-size, x-sprite-cols, x-sprite-rows, x-sprite-count, x-sprite-tokens',
  )
  res.send(sprite)
}
