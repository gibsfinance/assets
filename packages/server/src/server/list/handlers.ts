/**
 * @module list/handlers
 * Express routes for token list endpoints: merged, by-provider, by-chain.
 *
 * `/list/merged/default` — tokens across all providers for one chain (chainId required).
 * `/list/{provider}/{key}` — single provider list in its native order.
 * `/list/tokensByChain/{chainId}` — all tokens for a chain, ordered by provider ranking
 * via `applyOrder(sorted: true)` with separate sources query for providerKey/listKey.
 */
import createError from 'http-errors'
import * as db from '../../db'
import type { RequestHandler } from 'express'
import * as utils from './utils'
import _ from 'lodash'
import config from '../../../config'
import { bumpSubscriberCount } from '../../collect/user-submissions'
import { failureLog } from '@gibs/utils'
import { getDrizzle } from '../../db/drizzle'
import { eq, and, or, inArray, sql as dsql } from 'drizzle-orm'
import * as s from '../../db/schema'
import { getDefaultListOrderId } from '../../db/sync-order'
import {
  toCAIP2,
  fromCAIP2,
  isValidChainId,
  isBareNumeric,
  resolveChainIdAgainstStored,
  chainIdFilterMatch,
} from '../../chain-id'
import { log, timerLog } from '../../logger'

export const merged: RequestHandler = async (req, res, next) => {
  const rawChainId = req.query.chainId as string | undefined
  // Without a chain filter the dense_rank CTE materializes every chain's
  // list_token rows and cannot complete inside production timeouts (~60s, then
  // 500) — requiring the parameter is the honest contract.
  if (!rawChainId) {
    return next(createError.BadRequest('chainId query parameter is required'))
  }
  const extensions = utils.parseExtensions(req.query.extensions)
  const orderId = await db.getListOrderId(req.params.order)
  if (!orderId) {
    return next(createError.NotFound('order id missing'))
  }
  // Same namespace resolution as tokensByChain — a bare number must not be assumed
  // to be eip155, or non-EVM chains silently return an empty list.
  const storedCandidates = isBareNumeric(rawChainId) ? await db.getChainIdsByReference(rawChainId) : []
  const resolution = resolveChainIdAgainstStored(rawChainId, storedCandidates)
  if (resolution.status === 'ambiguous') {
    return next(
      createError.BadRequest(
        `ambiguous chainId "${rawChainId}" — it exists in several namespaces (${resolution.candidates.join(', ')}); request one explicitly`,
      ),
    )
  }
  const whereClause = and(dsql`${s.network.chainId} != 'asset-0'`, eq(s.network.chainId, resolution.chainId))!
  const tokens = await db.applyOrder(orderId, whereClause, 'listToken')
  const filters = utils.tokenFilters(req.query)
  const entries = utils.normalizeTokens(tokens as any, filters, extensions)
  res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  res.json(utils.minimalList(entries))
}

export const versioned: RequestHandler = async (req, res, next) => {
  const extensions = utils.parseExtensions(req.query.extensions)
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
  const extensions = utils.parseExtensions(req.query.extensions)
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
    // A bare chain number names no namespace, so match it against the stored id's
    // reference — ?chain_id=501 must reach solana-501, not just eip155-501. An
    // explicit id keeps exact equality, since it is an assertion about namespace.
    if (k === 'chain_id') {
      const values = (_.isArray(v) ? v : [v]) as string[]
      // OR across values, matching the inArray semantics this replaced — several
      // chain ids mean "any of these", never "all of them at once".
      const matches = values.map((value) => {
        const match = chainIdFilterMatch(value)
        return match.kind === 'reference'
          ? dsql`split_part(${col}, '-', 2) = ${match.reference}`
          : eq(col, match.chainId)
      })
      conditions.push(or(...matches) as ReturnType<typeof eq>)
      continue
    }
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
  // Validate at the boundary — unvalidated values against typed columns
  // (boolean `default`, integer versions) surface as Postgres errors (500).
  const filters = utils.parseListFilters(req.query as Record<string, unknown>)
  res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  res.json(await getFilteredLists(filters))
}

/**
 * GET /list/tokens/:chainId
 * Returns all deduplicated tokens for a chain in a single response.
 * Server-side merge eliminates the need for N individual list fetches.
 * Supports ?limit=N (default 500, max 5000)
 */
const FRESH_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours — serve without revalidation
const STALE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours — serve stale while refreshing in background
const WARM_STALE_MS = 12 * 60 * 60 * 1000 // 12 hours — periodic warmer re-builds cache rows older than this
const DEFAULT_TOKENS_BY_CHAIN_LIMIT = 50_000 // shared by the request handler and the cache warmer
const MAX_TOKENS_BY_CHAIN_LIMIT = 100_000

/**
 * Cache key for a tokensByChain response. The warmer and the request handler must
 * produce byte-identical keys or warmed rows are never read — build keys only here.
 *
 * Extensions are deliberately NOT part of the key: the ranked query selects no
 * bridge/header columns, so `?extensions=` never changed the output and each
 * distinct value needlessly forked the cache. The trailing colon is the legacy
 * empty-extensions slot, kept so already-warmed rows stay readable.
 */
export const tokensByChainCacheKey = (chainId: string, limit: number) => `tokens-by-chain:${chainId}:${limit}:`

/** Cache rows only store expiresAt (= createdAt + STALE_TTL_MS), so age is derived from it. */
export const cacheRowAge = (row: { expiresAt: Date | string | null }) =>
  Date.now() - (new Date(row.expiresAt!).getTime() - STALE_TTL_MS)

/** Persist a built tokensByChain body with the standard stale-TTL expiry. */
export const writeTokensByChainCache = (cacheKey: string, body: string) =>
  db.insertCacheRequest({ key: cacheKey, value: body, expiresAt: new Date(Date.now() + STALE_TTL_MS) as any })

/** Build the JSON response body for tokensByChain (shared by fresh + revalidation paths).
 *
 * Uses getTokensByChainRanked() — DISTINCT ON over a flat join with pre-aggregated
 * list rankings — to return one row per token (best-ranked provider wins). This
 * replaces the prior dense_rank() CTE which materialized all list_token rows for the
 * chain and sorted them globally — too slow for large chains like Ethereum mainnet.
 *
 * A separate lightweight selectDistinct query fetches all providerKey/listKey memberships
 * for the sources field.
 */
const buildTokensByChainResponse = async (chainId: string, limit: number) => {
  const defaultOrderId = getDefaultListOrderId()

  const t0 = performance.now()
  const [tokens, sourcesRows] = await Promise.all([
    defaultOrderId
      ? db.getTokensByChainRanked(chainId, defaultOrderId)
      : db.getTokensUnderListId().where(eq(s.network.chainId, chainId)),
    defaultOrderId
      ? db.getTokenSourcesByChain(chainId)
      : Promise.resolve([] as Awaited<ReturnType<typeof db.getTokenSourcesByChain>>),
  ])
  timerLog(
    'tokensByChain %s: %d token rows + %d source rows in %dms',
    chainId,
    tokens.length,
    sourcesRows.length,
    Math.round(performance.now() - t0),
  )

  // Build address → sources[] map to patch onto entries after normalizeTokens.
  // normalizeTokens only sees one row per token (already deduped), so we populate
  // sources from this separate query rather than from duplicate rows.
  const sourcesMap = new Map<string, string[]>()
  for (const { providedId, providerKey, listKey } of sourcesRows) {
    // Key identically to normalizeTokens' groupBy so the sources patch matches;
    // normalizeProvidedId keeps base58 ids case-significant (a bare .toLowerCase()
    // here would miss every non-Ethereum-Virtual-Machine token's sources).
    const key = db.normalizeProvidedId(providedId)
    const source = `${providerKey}/${listKey}`
    const existing = sourcesMap.get(key)
    if (existing) {
      existing.push(source)
    } else {
      sourcesMap.set(key, [source])
    }
  }

  // getTokensByChainRanked() already orders by provider ranking — no JS sort needed.
  const allEntries = utils.normalizeTokens(tokens as any)

  // Patch full sources onto each entry (normalizeTokens would only see the winning row's source).
  for (const entry of allEntries) {
    const fullSources = sourcesMap.get(entry.address as string)
    if (fullSources) entry.sources = fullSources
  }

  // Only return tokens that have images — imageless tokens aren't useful to display
  const entries = allEntries.filter((e: (typeof allEntries)[number]) => e.logoURI)
  const limited = entries.slice(0, limit)

  return JSON.stringify({
    chainId: +fromCAIP2(chainId),
    chainIdentifier: chainId,
    total: entries.length,
    tokens: limited,
  })
}

// Single-flight build + cache write: concurrent cold requests, stale revalidations,
// and warmer ticks for the same key share one query pass, one serialization, and one
// cache write — this is the only place a tokensByChain body is built or persisted.
const inflightBuilds = new Map<string, Promise<string>>()

export const buildAndCacheTokensByChain = (chainId: string, limit: number): Promise<string> => {
  const cacheKey = tokensByChainCacheKey(chainId, limit)
  const existing = inflightBuilds.get(cacheKey)
  if (existing) return existing
  const promise = buildTokensByChainResponse(chainId, limit).then((body) => {
    // Fire-and-forget: a cold request must not wait on the multi-megabyte cache INSERT,
    // and a cache-write failure must not fail the response — the body is still servable.
    writeTokensByChainCache(cacheKey, body).catch((err: unknown) => log('cache write failed for %s: %o', cacheKey, err))
    return body
  })
  inflightBuilds.set(cacheKey, promise)
  return promise.finally(() => inflightBuilds.delete(cacheKey))
}

/**
 * Pre-warm the tokensByChain cache for the top N chains by token count.
 *
 * Called at startup (before /health flips to 200) and then periodically. Rebuilds
 * any top-N chain whose cache row is missing or older than WARM_STALE_MS, so the
 * cache row never ages past the stale threshold even without user traffic.
 */
export const warmTokensByChainCache = async (stats: { chainId: string; count: number }[], topN = 5): Promise<void> => {
  const top = stats.slice(0, topN)
  for (const { chainId: rawChainId } of top) {
    try {
      const chainId = toCAIP2(rawChainId)
      const limit = DEFAULT_TOKENS_BY_CHAIN_LIMIT
      const cacheKey = tokensByChainCacheKey(chainId, limit)
      const existing = await db.getCachedRequest(cacheKey)
      if (existing && cacheRowAge(existing) < WARM_STALE_MS) continue
      await buildAndCacheTokensByChain(chainId, limit)
    } catch {
      // best-effort — startup must not fail if a chain is unavailable
    }
  }
}

export const tokensByChain: RequestHandler = async (req, res, next) => {
  const rawChainId = req.params.chainId
  if (!rawChainId) return next(createError.BadRequest('chainId required'))
  // Stored networks only carry eip155-<number> or asset-0 — anything else can
  // never match a row, so reject it instead of answering 200 with zero tokens.
  if (!isValidChainId(rawChainId)) {
    return next(
      createError.BadRequest(
        `invalid chainId "${rawChainId}" — expected a numeric id (369) or a prefixed id (eip155-369)`,
      ),
    )
  }
  // Accept both bare numbers (369) and CAIP-2 (eip155-369) — DB stores CAIP-2.
  // A bare number carries no namespace, so resolve it against the identifiers that
  // actually hold rows rather than assuming eip155, which reached past Solana and
  // Tron and answered an empty 200. See resolveChainIdAgainstStored.
  // Only a bare number is ambiguous, so an explicit identifier costs no extra query.
  const storedCandidates = isBareNumeric(rawChainId) ? await db.getChainIdsByReference(rawChainId) : []
  const resolution = resolveChainIdAgainstStored(rawChainId, storedCandidates)
  if (resolution.status === 'ambiguous') {
    return next(
      createError.BadRequest(
        `ambiguous chainId "${rawChainId}" — it exists in several namespaces (${resolution.candidates.join(', ')}); request one explicitly`,
      ),
    )
  }
  const chainId = resolution.chainId

  const limit = utils.parseTokenLimit(req.query.limit, {
    fallback: DEFAULT_TOKENS_BY_CHAIN_LIMIT,
    max: MAX_TOKENS_BY_CHAIN_LIMIT,
  })
  const cacheKey = tokensByChainCacheKey(chainId, limit)

  // CDN cache-control: fresh window matches FRESH_TTL_MS; stale-while-revalidate
  // allows CDN to serve stale for STALE_TTL_MS while we rebuild in background.
  // Don't let CDN cache for the server's cacheSeconds (24h in prod) — stats change
  // as new tokens are collected and the CDN would serve stale counts for a day.
  const tokenListCacheControl = `public, max-age=${Math.floor(FRESH_TTL_MS / 1000)}, stale-while-revalidate=${Math.floor(STALE_TTL_MS / 1000)}`

  // Check cache — expiresAt is the hard 1hr expiry
  const cached = await db.getCachedRequest(cacheKey)
  if (cached) {
    res.set('cache-control', tokenListCacheControl)
    res.set('content-type', 'application/json')
    res.send(cached.value)

    // If stale (past the fresh window), revalidate in the background — concurrent
    // stale hits share the same in-flight build via buildAndCacheTokensByChain.
    if (cacheRowAge(cached) > FRESH_TTL_MS) {
      buildAndCacheTokensByChain(chainId, limit).catch((err: unknown) =>
        log('background revalidate failed for %s: %o', cacheKey, err),
      )
    }
    return
  }

  // No cache — build fresh (first request or after hard expiry)
  const body = await buildAndCacheTokensByChain(chainId, limit)

  res.set('cache-control', tokenListCacheControl)
  res.set('content-type', 'application/json')
  res.send(body)
}
