/**
 * @module list/handlers
 * Express routes for token list endpoints: merged, by-provider, by-chain.
 *
 * `/list/merged/default` — tokens across all providers for one chain (chainId required).
 * `/list/{provider}/{key}` — single provider list in its native order.
 * `/list/tokensByChain/{chainId}` — all tokens for a chain, ordered by provider ranking.
 *
 * Both chain-scoped endpoints read through `getTokensByChainRanked`, which returns one
 * row per token in ranking order; tokensByChain adds a separate lightweight query for
 * the providerKey/listKey `sources` field.
 *
 * Both also cache their assembled body through `./response-cache`. They are the same
 * query over the same rows, and merged is the larger of the two — it keeps tokens
 * without a logo, where tokensByChain drops them — so leaving it uncached meant the
 * heavier endpoint was the one paying full price on every request: sixteen to
 * twenty-two seconds against roughly one.
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
import { timerLog } from '../../logger'
import { refreshRequest, REFRESH_CACHE_CONTROL } from '../cache-refresh'
import {
  buildAndCache,
  cacheRowAge,
  FRESH_TTL_MS,
  listCacheControl,
  namespacedCacheKey,
  serveCachedJson,
  writeCachedResponse,
} from './response-cache'

export { cacheRowAge }

/**
 * Fold a possibly-repeated query value into a stable, order-independent key fragment,
 * so `?decimals=6&decimals=18` and `?decimals=18&decimals=6` name one cached body, not
 * two. Absent values collapse to the empty string.
 */
const sortedQueryValues = (value: unknown): string =>
  (Array.isArray(value) ? value : value == null ? [] : [value])
    .map((entry) => `${entry}`)
    .sort()
    .join(',')

/**
 * Cache key for a merged list response.
 *
 * Everything that changes the body has to appear here, and nothing else may. The
 * order is keyed by its resolved id rather than the `:order` path segment, so that
 * re-syncing the default order produces new keys and the old bodies age out on their
 * own instead of being served under a ranking that no longer exists.
 *
 * `chainId` is the resolved identifier, not the raw query value: `?chainId=369` and
 * `?chainId=eip155-369` name the same chain and must not each get their own copy of a
 * twelve-megabyte body. Extensions and decimals are sorted for the same reason —
 * `bridgeInfo,headerUri` and `headerUri,bridgeInfo` are one response, not two.
 */
export const mergedCacheKey = ({
  orderId,
  chainId,
  extensions,
  decimals,
}: {
  orderId: string
  chainId: string
  extensions: Set<string>
  decimals?: unknown
}) => {
  const ext = [...extensions].sort().join(',')
  return namespacedCacheKey(`merged:${orderId}:${chainId}:${ext}:${sortedQueryValues(decimals)}`)
}

/**
 * Cache key for a single provider (or versioned) list response.
 *
 * Keyed by the request's own coordinates — provider key, list key, and version — rather
 * than by the resolved `listId`. Deriving the id means `getLists`, whose join over every
 * `list_token` row is the expensive part of the request (seconds on a large list): keying
 * on it would force that query on every hit and defeat the cache. These coordinates are
 * known from the path before any query runs, so a warm request does no database work
 * beyond the single cache read. A `version` of `''` is the providerKeyed "latest" case,
 * which a new publish supersedes via the six-hour fresh window rather than a new key.
 *
 * Extensions and the optional chainId/decimals filters are folded in exactly as
 * `mergedCacheKey` does: sorted, so argument order never forks the cache. The same
 * junk-key exposure `merged` carries applies here — an unrecognized extension or filter
 * value still mints a distinct key even when it does not change the body — bounded by the
 * twenty-four-hour row expiry, the content delivery network in front, and the admin-gated
 * refresh, and left identical to `merged` on purpose.
 */
export const listCacheKey = ({
  providerKey,
  listKey,
  version,
  extensions,
  chainId,
  decimals,
}: {
  providerKey: string
  listKey?: string
  version?: string
  extensions: Set<string>
  chainId?: unknown
  decimals?: unknown
}) => {
  const ext = [...extensions].sort().join(',')
  return namespacedCacheKey(
    `list:${providerKey}:${listKey ?? ''}:${version ?? ''}:${ext}:${sortedQueryValues(chainId)}:${sortedQueryValues(decimals)}`,
  )
}

/**
 * Assemble the merged list body for one chain. Shared by the request handler and the
 * cache warmer so a warmed row is byte-identical to a request-built one — if these
 * ever diverged, the warmer would fill the cache with bodies no request could read.
 */
const buildMergedResponse = async ({
  chainId,
  orderId,
  extensions,
  filters,
}: {
  chainId: string
  orderId: string
  extensions: Set<string>
  filters: ReturnType<typeof utils.tokenFilters>
}) => {
  const tokens =
    chainId === 'asset-0'
      ? []
      : await db.getTokensByChainRanked(chainId, orderId as never, {
          bridgeInfo: extensions.has('bridgeInfo'),
          headerUri: extensions.has('headerUri'),
        })
  const entries = utils.normalizeTokens(tokens as any, filters, extensions)
  // minimalList stamps `timestamp` with the current time, so a cached body reports
  // when it was assembled rather than when it was served. That is the more useful
  // of the two — it is the age of the data, which is what a consumer of a token
  // list is actually asking about.
  return JSON.stringify(utils.minimalList(entries))
}

/**
 * Pre-warm the merged cache for the top N chains by token count.
 *
 * `/list/merged/:order` is the heavier of the two chain-scoped endpoints — it keeps
 * tokens without a logo where tokensByChain drops them — but only tokensByChain was
 * being warmed, so merged was the one endpoint whose cold build a real user could
 * still land on. Startup used to delete every cached row, which meant each deploy left
 * merged cold until someone happened to request it and waited out the full build; rows
 * now survive a restart, so this runs to refresh them rather than to rebuild from
 * nothing.
 *
 * Warms the canonical shape only: default order, no extensions, no filters. That is
 * the key an unqualified `?chainId=` request produces, and warming the filtered
 * variants would multiply the work by a key space nobody is asking for.
 */
export const warmMergedCache = async (
  stats: { chainId: string; count: number }[],
  topN = WARM_CHAIN_COUNT,
): Promise<void> => {
  const orderId = getDefaultListOrderId()
  if (!orderId) return
  const extensions = new Set<string>()
  const filters = utils.tokenFilters({})
  for (const { chainId: rawChainId } of stats.slice(0, topN)) {
    try {
      const chainId = toCAIP2(rawChainId)
      const cacheKey = mergedCacheKey({ orderId, chainId, extensions, decimals: undefined })
      const existing = await db.getCachedRequest(cacheKey)
      if (existing && cacheRowAge(existing) < WARM_STALE_MS) continue
      await buildAndCache(cacheKey, () => buildMergedResponse({ chainId, orderId, extensions, filters }))
    } catch {
      // best-effort, exactly as the tokensByChain warmer treats it — a chain that
      // cannot be built must not take down startup or the periodic tick.
    }
  }
}

export const merged: RequestHandler = async (req, res, next) => {
  const rawChainId = req.query.chainId as string | undefined
  // Without a chain filter the dense_rank CTE materializes every chain's
  // list_token rows and cannot complete inside production timeouts (~60s, then
  // 500) — requiring the parameter is the honest contract.
  if (!rawChainId) {
    return next(createError.BadRequest('chainId query parameter is required'))
  }
  // Same reasoning as tokensByChain, and more so — this is the heavier of the two
  // endpoints. An open refresh parameter would let anyone force the full per-chain
  // ranked query on every request, which is a denial of service lever. Reject it
  // rather than quietly downgrading to a cached read, so an operator who thinks they
  // verified against fresh data is never wrong about that.
  const refresh = refreshRequest({
    refreshParam: req.query.refresh,
    authorizationHeader: req.headers.authorization,
    adminToken: config.adminToken,
  })
  if (refresh.requested && !refresh.authorized) {
    return next(createError.Unauthorized('unauthorized'))
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
  // Same ranked query tokensByChain uses. This endpoint previously went through
  // applyOrder's dense_rank window, which materializes every list_token row for the
  // chain and sorts them globally — the exact query that was replaced there for being
  // too slow on large chains. It never stopped being too slow here: Ethereum, Binance
  // Smart Chain and every other chain of that size returned a 500 at the sixty-second
  // ceiling, and only PulseChain answered at all. The handler already documented this
  // failure a few lines above but guarded only the case where no chain was named.
  //
  // Selection is equivalent — one row per token, best-ranked list wins — with two
  // deliberate differences carried over from the newer query: rows come back in
  // provider-ranking order rather than unordered, and a list entry whose image
  // actually resolves is preferred over one whose does not. normalizeTokens is
  // already written against that second rule; its "first usable image" pick names
  // this query as its counterpart.
  //
  // asset-0 is the internal bookkeeping sentinel, excluded by the where clause this
  // replaces. Keep answering an empty list for it rather than serving sentinel rows.
  //
  // The extension flags are passed through because this endpoint used to accept
  // `?extensions=` and quietly answer without them: the query behind it joined
  // neither the bridge tables nor header_link, so every token came back with the
  // columns normalizeTokens reads for extensions simply absent. Against production
  // that was nothing with extensions on /list/merged against 1290 on a provider list.
  const filters = utils.tokenFilters(req.query)

  await serveCachedJson(res, {
    cacheKey: mergedCacheKey({ orderId, chainId: resolution.chainId, extensions, decimals: req.query.decimals }),
    build: () => buildMergedResponse({ chainId: resolution.chainId, orderId, extensions, filters }),
    cacheControl: listCacheControl,
    bypassCache: refresh.authorized,
    bypassCacheControl: REFRESH_CACHE_CONTROL,
  })
}

/**
 * Reject an unauthorized refresh, or report an authorized one. Provider lists are the
 * same class of expensive assembly as merged and tokensByChain, so they gate `?refresh=`
 * the same way: an open refresh would let anyone force a full per-list token fetch on
 * every request. A caller who thinks they verified against fresh data is told plainly
 * when their token was rejected, rather than quietly handed a cached body.
 */
const guardListRefresh = (req: Parameters<RequestHandler>[0]) =>
  refreshRequest({
    refreshParam: req.query.refresh,
    authorizationHeader: req.headers.authorization,
    adminToken: config.adminToken,
  })

export const versioned: RequestHandler = async (req, res, next) => {
  const refresh = guardListRefresh(req)
  if (refresh.requested && !refresh.authorized) {
    return next(createError.Unauthorized('unauthorized'))
  }
  const extensions = utils.parseExtensions(req.query.extensions)
  const filters = utils.tokenFilters(req.query)
  // Resolving the version and assembling its tokens is the request's real cost, so both
  // run only inside build — a cache hit never reaches them. The version-not-found 404
  // therefore surfaces as a throw from build, which nextOnError turns into next(error).
  const build = async () => {
    const [major, minor, patch] = (req.params.version || '').split('.')
    const allLists = await db.getLists(req.params.providerKey, req.params.listKey)
    const match = allLists.find(
      (row) => String(row.major) === major && String(row.minor) === minor && String(row.patch) === patch,
    )
    if (!match) {
      throw createError.NotFound('versioned list missing')
    }
    return JSON.stringify(await utils.buildListPayload(match, filters, extensions))
  }
  await serveCachedJson(res, {
    cacheKey: listCacheKey({
      providerKey: req.params.providerKey,
      listKey: req.params.listKey,
      version: req.params.version,
      extensions,
      chainId: req.query.chainId,
      decimals: req.query.decimals,
    }),
    build,
    cacheControl: listCacheControl,
    bypassCache: refresh.authorized,
    bypassCacheControl: REFRESH_CACHE_CONTROL,
  })
}

/**
 * How many provider lists the warmer covers.
 *
 * There are 1193 of them and warming all of them would cost far more than it saves —
 * most are small enough that a cold build is already under half a second. Twenty covers
 * the expensive tail, where coingecko/ethereum alone is 3.38s cold.
 */
const WARM_PROVIDER_LIST_COUNT = 20

/**
 * Pre-warm the provider-list cache for the largest lists.
 *
 * These were the one cached endpoint nobody warmed. Every list response was built by
 * whichever user asked for it first, and because startup deleted the whole cache, that
 * happened again after every deploy.
 *
 * Warms the canonical shape only — no extensions, no chain or decimals filter — which is
 * the key a bare `/list/:providerKey/:listKey` produces. Warming filtered variants would
 * multiply the work across a key space nobody has asked for.
 *
 * The build below has to stay identical to the one in `providerKeyed`, including the
 * missing-list throw: a warmed body that differs from a request-built one is worse than
 * no warm at all, because it is served in preference to the real thing.
 */
export const warmProviderListCache = async (topN = WARM_PROVIDER_LIST_COUNT): Promise<void> => {
  const extensions = new Set<string>()
  const filters = utils.tokenFilters({})
  let lists: { providerKey: string; listKey: string }[] = []
  try {
    lists = await db.getLargestLists(topN)
  } catch {
    return
  }
  for (const { providerKey, listKey } of lists) {
    try {
      const cacheKey = listCacheKey({ providerKey, listKey, extensions, chainId: undefined, decimals: undefined })
      const existing = await db.getCachedRequest(cacheKey)
      if (existing && cacheRowAge(existing) < WARM_STALE_MS) continue
      await buildAndCache(cacheKey, async () => {
        const rows = await db.getLists(providerKey, listKey)
        const list = rows[0]
        if (!list) {
          throw createError.NotFound(JSON.stringify({ providerKey, listKey }))
        }
        return JSON.stringify(await utils.buildListPayload(list, filters, extensions))
      })
    } catch {
      // best-effort, as with the chain warmers — one unbuildable list must not stop the
      // rest or take down startup.
    }
  }
}

export const providerKeyed: RequestHandler = async (req, res, next) => {
  const refresh = guardListRefresh(req)
  if (refresh.requested && !refresh.authorized) {
    return next(createError.Unauthorized('unauthorized'))
  }
  const providerKey = req.params.providerKey
  const listKey = req.params.listKey
  // Bump on every request, cache hit or miss — it counts subscribers, not rebuilds, so
  // it runs here rather than inside the (cache-skipping) build. The update matches zero
  // rows for a provider that does not exist, so bumping before that is known is harmless.
  if (providerKey.startsWith('user-')) {
    bumpSubscriberCount(providerKey).catch((e: Error) => failureLog('bump failed: %s', e.message))
  }
  const extensions = utils.parseExtensions(req.query.extensions)
  const filters = utils.tokenFilters(req.query)
  // Resolving the list and assembling its tokens is the request's real cost, so both run
  // only inside build; a cache hit never reaches them. The list-not-found 404 surfaces as
  // a throw, which nextOnError forwards.
  const build = async () => {
    const rows = await db.getLists(providerKey, listKey)
    const list = rows[0]
    if (!list) {
      throw createError.NotFound(JSON.stringify({ providerKey, listKey }))
    }
    return JSON.stringify(await utils.buildListPayload(list, filters, extensions))
  }
  await serveCachedJson(res, {
    cacheKey: listCacheKey({
      providerKey,
      listKey,
      extensions,
      chainId: req.query.chainId,
      decimals: req.query.decimals,
    }),
    build,
    cacheControl: listCacheControl,
    bypassCache: refresh.authorized,
    bypassCacheControl: REFRESH_CACHE_CONTROL,
  })
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
/**
 * Age at which the periodic warmer rebuilds a row, deliberately equal to the freshness
 * window rather than a separate number.
 *
 * It was twelve hours against a six-hour freshness window, which meant a warmed row
 * spent between six and eighteen hours being served stale-while-revalidate: correct, but
 * every user in that window got yesterday's body and paid for a background rebuild the
 * warmer was supposed to have already done. Tying the two together makes the warmer's
 * job say what it means — keep the warmed rows fresh — and matches the six-hourly
 * collection cadence that produces new data in the first place.
 */
const WARM_STALE_MS = FRESH_TTL_MS

/**
 * How many chains each warmer covers.
 *
 * Five left the sixth through fourteenth chains cold, and they are not marginal: each
 * holds over three hundred tokens. Measured cold against staging, chain 137 took 4.72s,
 * 42161 3.37s, 43114 1.97s, 10 1.61s and 100 0.77s, against 0.27s to 0.37s once warm.
 * Twelve covers every chain with a meaningful token count for roughly fifteen seconds
 * more startup, and the readiness gate already tolerates far more than that.
 */
const WARM_CHAIN_COUNT = 12

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
export const tokensByChainCacheKey = (chainId: string, limit: number) =>
  namespacedCacheKey(`tokens-by-chain:${chainId}:${limit}:`)

/** Persist a built tokensByChain body with the standard stale-TTL expiry. */
export const writeTokensByChainCache = writeCachedResponse

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

export const buildAndCacheTokensByChain = (chainId: string, limit: number): Promise<string> =>
  buildAndCache(tokensByChainCacheKey(chainId, limit), () => buildTokensByChainResponse(chainId, limit))

/**
 * Pre-warm the tokensByChain cache for the top N chains by token count.
 *
 * Called at startup (before /health flips to 200) and then periodically. Rebuilds
 * any top-N chain whose cache row is missing or older than WARM_STALE_MS, so the
 * cache row never ages past the stale threshold even without user traffic.
 */
export const warmTokensByChainCache = async (
  stats: { chainId: string; count: number }[],
  topN = WARM_CHAIN_COUNT,
): Promise<void> => {
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
  const refresh = refreshRequest({
    refreshParam: req.query.refresh,
    authorizationHeader: req.headers.authorization,
    adminToken: config.adminToken,
  })
  // This is the expensive endpoint — an unauthenticated refresh would let anyone
  // force the full per-chain ranked query on demand, which is a denial of service
  // lever. Reject it outright instead of downgrading to a cached read.
  if (refresh.requested && !refresh.authorized) {
    return next(createError.Unauthorized('unauthorized'))
  }
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
  await serveCachedJson(res, {
    cacheKey: tokensByChainCacheKey(chainId, limit),
    build: () => buildTokensByChainResponse(chainId, limit),
    cacheControl: listCacheControl,
    bypassCache: refresh.authorized,
    bypassCacheControl: REFRESH_CACHE_CONTROL,
  })
}
