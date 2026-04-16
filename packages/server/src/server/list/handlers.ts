/**
 * @module list/handlers
 * Express routes for token list endpoints: merged, by-provider, by-chain.
 *
 * `/list/merged/default` — all tokens across all providers, no specific order.
 * `/list/{provider}/{key}` — single provider list in its native order.
 * `/list/tokensByChain/{chainId}` — all tokens for a chain, ordered by provider ranking
 * via `applyOrder(sorted: true)` with separate sources query for providerKey/listKey.
 */
import createError from 'http-errors'
import * as db from '../../db'
import type { Request, RequestHandler } from 'express'
import * as utils from './utils'
import _ from 'lodash'
import config from '../../../config'
import { bumpSubscriberCount } from '../../collect/user-submissions'
import { failureLog } from '@gibs/utils'
import { getDrizzle } from '../../db/drizzle'
import { eq, and, inArray, sql as dsql } from 'drizzle-orm'
import * as s from '../../db/schema'
import { getDefaultListOrderId } from '../../db/sync-order'
import { toCAIP2, fromCAIP2 } from '../../chain-id'

export const merged: RequestHandler = async (req, res, next) => {
  const extensions = getExtensions(req)
  const orderId = await db.getListOrderId(req.params.order)
  if (!orderId) {
    return next(createError.NotFound('order id missing'))
  }
  const chainId = req.query.chainId as string | undefined
  const whereClause = chainId
    ? and(dsql`${s.network.chainId} != 'asset-0'`, eq(s.network.chainId, toCAIP2(chainId)))!
    : dsql`${s.network.chainId} != 'asset-0'`
  const tokens = await db.applyOrder(orderId, whereClause, 'listToken')
  const filters = utils.tokenFilters(req.query)
  const entries = utils.normalizeTokens(tokens as any, filters, extensions)
  res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  res.json(utils.minimalList(entries))
}

const getExtensions = (req: Request) => {
  const extensions = req.query.extensions
  if (!extensions) return new Set<string>()
  if (_.isArray(extensions)) return new Set(extensions as string[])
  return new Set([extensions as string])
}

export const versioned: RequestHandler = async (req, res, next) => {
  const extensions = getExtensions(req)
  const [major, minor, patch] = (req.params.version || '').split('.')
  const allLists = await db.getLists(req.params.providerKey, req.params.listKey)
  const match = allLists.find(
    (row) =>
      String(row.list?.major) === major && String(row.list?.minor) === minor && String(row.list?.patch) === patch,
  )
  if (!match) {
    return next(createError.NotFound('versioned list missing'))
  }
  const list = { ...match.list, ...match.image, ...match.provider, ...match.list_token }
  const filters = utils.tokenFilters(req.query)
  await utils.respondWithList(res, list as any, filters, extensions)
}

export const providerKeyed: RequestHandler = async (req, res, next) => {
  const extensions = getExtensions(req)
  const providerKey = req.params.providerKey
  const rows = await db.getLists(providerKey, req.params.listKey)
  const first = rows[0]
  if (!first) {
    return next(
      createError.NotFound(
        JSON.stringify({
          providerKey,
          listKey: req.params.listKey,
        }),
      ),
    )
  }
  if (providerKey.startsWith('user-')) {
    bumpSubscriberCount(providerKey).catch((e: Error) => failureLog('bump failed: %s', e.message))
  }
  const list = { ...first.list, ...first.image, ...first.provider, ...first.list_token }
  const filters = utils.tokenFilters(req.query)
  await utils.respondWithList(res, list as any, filters, extensions)
}

const getFilteredLists = async (filter: Record<string, unknown>) => {
  const drizzle = getDrizzle()
  let q = drizzle
    .select({
      key: s.list.key,
      name: s.list.name,
      description: s.list.description,
      default: s.list.default,
      providerKey: s.provider.key,
      chainId: s.network.chainId,
      chainType: s.network.type,
      major: s.list.major,
      minor: s.list.minor,
      patch: s.list.patch,
    })
    .from(s.list)
    .leftJoin(s.provider, eq(s.provider.providerId, s.list.providerId))
    .leftJoin(s.network, eq(s.network.networkId, s.list.networkId))
    .$dynamic()

  // Build WHERE conditions from the filter object
  const conditions: ReturnType<typeof eq>[] = []
  // Map of known filter keys to their Drizzle column references
  const columnMap: Record<string, any> = {
    key: s.list.key,
    name: s.list.name,
    default: s.list.default,
    provider_key: s.provider.key,
    chain_id: s.network.chainId,
    chain_type: s.network.type,
    major: s.list.major,
    minor: s.list.minor,
    patch: s.list.patch,
  }
  for (const [k, v] of Object.entries(filter)) {
    const col = columnMap[k]
    if (!col) continue
    if (_.isArray(v)) {
      conditions.push(inArray(col, v as string[]))
    } else {
      conditions.push(eq(col, v as string))
    }
  }
  if (conditions.length) {
    q = q.where(and(...conditions))
  }
  return q
}

export const all: RequestHandler = async (req, res) => {
  res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  res.json(await getFilteredLists(req.query as Record<string, unknown>))
}

/**
 * GET /list/tokens/:chainId
 * Returns all deduplicated tokens for a chain in a single response.
 * Server-side merge eliminates the need for N individual list fetches.
 * Supports ?limit=N (default 500, max 5000)
 */
const FRESH_TTL_MS = 5 * 60 * 1000 // 5 minutes — serve without revalidation
const STALE_TTL_MS = 60 * 60 * 1000 // 1 hour — serve stale while refreshing in background

/** Build the JSON response body for tokensByChain (shared by fresh + revalidation paths).
 *
 * Uses getTokensByChainRanked() — a LATERAL-join query — to return one row per token
 * (best-ranked provider wins per-token via LATERAL LIMIT 1). This replaces the prior
 * dense_rank() CTE which materialized all list_token rows for the chain and sorted them
 * globally — too slow for large chains like Ethereum mainnet.
 *
 * A separate lightweight selectDistinct query fetches all providerKey/listKey memberships
 * for the sources field.
 */
export const buildTokensByChainResponse = async (chainId: string, limit: number, extensions: Set<string>) => {
  const defaultOrderId = getDefaultListOrderId()

  const t0 = performance.now()
  const [tokens, sourcesRows] = await Promise.all([
    (defaultOrderId
      ? db.getTokensByChainRanked(chainId, defaultOrderId)
      : db.getTokensUnderListId().where(eq(s.network.chainId, chainId))
    ).then((r) => {
      console.log(
        `[tokensByChain] ranked query for ${chainId}: ${(performance.now() - t0).toFixed(0)}ms, ${r.length} rows`,
      )
      return r
    }),
    (defaultOrderId ? db.getTokenSourcesByChain(chainId) : Promise.resolve([])).then((r) => {
      console.log(
        `[tokensByChain] sources query for ${chainId}: ${(performance.now() - t0).toFixed(0)}ms, ${r.length} rows`,
      )
      return r
    }),
  ])

  // Build address → sources[] map to patch onto entries after normalizeTokens.
  // normalizeTokens only sees one row per token (already deduped), so we populate
  // sources from this separate query rather than from duplicate rows.
  const sourcesMap = new Map<string, string[]>()
  for (const { providedId, providerKey, listKey } of sourcesRows) {
    const key = providedId.toLowerCase()
    const source = `${providerKey}/${listKey}`
    const existing = sourcesMap.get(key)
    if (existing) {
      existing.push(source)
    } else {
      sourcesMap.set(key, [source])
    }
  }

  // getTokensByChainRanked() already orders by provider ranking — no JS sort needed.
  const filters = utils.tokenFilters({})
  const allEntries = utils.normalizeTokens(tokens as any, filters, extensions)

  // Patch full sources onto each entry (normalizeTokens would only see the winning row's source).
  for (const entry of allEntries) {
    const fullSources = sourcesMap.get(entry.address as string)
    if (fullSources) entry.sources = fullSources
  }

  // Only return tokens that have images — imageless tokens aren't useful to display
  const entries = allEntries.filter((e) => e.logoURI)
  const limited = entries.slice(0, limit)

  return JSON.stringify({
    chainId: +fromCAIP2(chainId),
    chainIdentifier: chainId,
    total: entries.length,
    tokens: limited,
  })
}

// In-flight revalidation tracker — prevents duplicate background refreshes
const revalidating = new Set<string>()

/**
 * Pre-warm the tokensByChain cache for the top N chains by token count.
 * Called at server startup so the first real request is served from cache.
 */
export const warmTokensByChainCache = async (stats: { chainId: string; count: number }[], topN = 5): Promise<void> => {
  const top = stats.slice(0, topN)
  for (const { chainId: rawChainId } of top) {
    try {
      const chainId = toCAIP2(rawChainId)
      const limit = 50_000
      const extensions = new Set<string>()
      const cacheKey = `tokens-by-chain:${chainId}:${limit}:`
      const existing = await db.getCachedRequest(cacheKey)
      if (existing) continue
      const body = await buildTokensByChainResponse(chainId, limit, extensions)
      const expiresAt = new Date(Date.now() + STALE_TTL_MS)
      await db.insertCacheRequest({ key: cacheKey, value: body, expiresAt: expiresAt as any })
    } catch {
      // best-effort — startup must not fail if a chain is unavailable
    }
  }
}

export const tokensByChain: RequestHandler = async (req, res, next) => {
  const rawChainId = req.params.chainId
  if (!rawChainId) return next(createError.BadRequest('chainId required'))
  // Accept both bare numbers (369) and CAIP-2 (eip155-369) — DB stores CAIP-2
  const chainId = toCAIP2(rawChainId)

  const limit = Math.min(Number(req.query.limit) || 50_000, 100_000)
  const extensions = getExtensions(req)
  const cacheKey = `tokens-by-chain:${chainId}:${limit}:${[...extensions].sort().join(',')}`

  // Check cache — expiresAt is the hard 1hr expiry
  const cached = await db.getCachedRequest(cacheKey)
  if (cached) {
    res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
    res.set('content-type', 'application/json')
    res.send(cached.value)

    // If stale (past 5min fresh window), revalidate in the background
    const cacheAge = Date.now() - new Date(cached.expiresAt!).getTime() + STALE_TTL_MS
    if (cacheAge > FRESH_TTL_MS && !revalidating.has(cacheKey)) {
      revalidating.add(cacheKey)
      buildTokensByChainResponse(chainId, limit, extensions)
        .then((body) => {
          const expiresAt = new Date(Date.now() + STALE_TTL_MS)
          return db.insertCacheRequest({ key: cacheKey, value: body, expiresAt: expiresAt as any })
        })
        .catch(() => {})
        .finally(() => revalidating.delete(cacheKey))
    }
    return
  }

  // No cache — build fresh (first request or after hard expiry)
  const body = await buildTokensByChainResponse(chainId, limit, extensions)

  const expiresAt = new Date(Date.now() + STALE_TTL_MS)
  db.insertCacheRequest({ key: cacheKey, value: body, expiresAt: expiresAt as any }).catch(() => {})

  res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  res.set('content-type', 'application/json')
  res.send(body)
}
