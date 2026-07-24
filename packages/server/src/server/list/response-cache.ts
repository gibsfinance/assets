/**
 * @module list/response-cache
 * Read-through caching for token list responses.
 *
 * Token list bodies are expensive to assemble and cheap to reuse: a chain-scoped
 * response is a multi-megabyte join over every list that mentions the chain, and it
 * only changes when a collection run lands. `tokensByChain` has been cached this way
 * since it was written; `merged` runs the same query and was not, which is why it
 * answered in sixteen to twenty-two seconds against tokensByChain's one. This module
 * is that machinery, factored out so both endpoints share one implementation and one
 * set of freshness rules.
 *
 * Three layers cooperate:
 *
 *  - `cache_request`, a table, so a restart does not cost every caller a rebuild.
 *  - a process-local in-flight map, so concurrent misses for the same key share one
 *    build rather than each running the query.
 *  - `cache-control` on the response, so a content delivery network absorbs the
 *    repeat traffic that never reaches us at all.
 *
 * Freshness is deliberately generous. Collection runs every six hours, so a body can
 * be served unrevalidated for that long, and served stale for a day after that while
 * a rebuild happens behind the request. Nothing here ever makes a caller wait on a
 * rebuild it did not need.
 */
import type { Response } from 'express'
import * as db from '../../db'
import { log } from '../../logger'

/** Serve without revalidating. Matches the six-hourly collection cadence. */
export const FRESH_TTL_MS = 6 * 60 * 60 * 1000
/** Serve stale while rebuilding behind the request. Also the row's hard expiry. */
export const STALE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * `cache-control` for a cached list body.
 *
 * Not the server's `cacheSeconds` (a day in production): lists change as tokens are
 * collected, and a content delivery network holding one for a day would serve counts
 * that are a day out of date with no way to correct them.
 */
export const listCacheControl = `public, max-age=${Math.floor(FRESH_TTL_MS / 1000)}, stale-while-revalidate=${Math.floor(STALE_TTL_MS / 1000)}`

/** Cache rows only store expiresAt (= createdAt + STALE_TTL_MS), so age is derived from it. */
export const cacheRowAge = (row: { expiresAt: Date | string | null }) =>
  Date.now() - (new Date(row.expiresAt!).getTime() - STALE_TTL_MS)

/** Persist a built body with the standard stale-TTL expiry. */
export const writeCachedResponse = (cacheKey: string, body: string) =>
  db.insertCacheRequest({ key: cacheKey, value: body, expiresAt: new Date(Date.now() + STALE_TTL_MS) as any })

/**
 * In-flight builds, keyed by cache key. Concurrent cold requests, background
 * revalidations and warmer ticks for the same key share one query pass, one
 * serialization and one cache write.
 *
 * Keys are namespaced by endpoint, so one map serves them all without collision.
 */
const inflightBuilds = new Map<string, Promise<string>>()

/**
 * Build a response body once per key, persist it, and hand the same promise to every
 * concurrent caller.
 *
 * The cache write is deliberately not awaited. A cold caller must not wait on a
 * multi-megabyte INSERT to get bytes it already has, and a failed write must not fail
 * the response — it only means the next caller rebuilds.
 *
 * @param cacheKey - Namespaced key; must be byte-identical across every caller for
 *   the same body, or warmed rows are never read.
 * @param build - Produces the serialized body. Called at most once per concurrent set.
 */
export const buildAndCache = (cacheKey: string, build: () => Promise<string>): Promise<string> => {
  const existing = inflightBuilds.get(cacheKey)
  if (existing) return existing
  const promise = build().then((body) => {
    writeCachedResponse(cacheKey, body).catch((err: unknown) => log('cache write failed for %s: %o', cacheKey, err))
    return body
  })
  inflightBuilds.set(cacheKey, promise)
  return promise.finally(() => inflightBuilds.delete(cacheKey))
}

/**
 * Answer a request from the cache when possible, otherwise build and cache it.
 *
 * A hit past the fresh window is still served immediately and rebuilt behind the
 * response — the caller who happened to arrive at the moment of expiry should not be
 * the one who pays for the rebuild.
 *
 * @param res - The response to write to. Left untouched on a build failure so the
 *   caller's error handler can answer instead.
 * @param options.cacheKey - Namespaced cache key.
 * @param options.build - Produces the serialized body on a miss.
 * @param options.cacheControl - Header value for a normal response.
 * @param options.bypassCache - Skip the read and rebuild unconditionally. This is the
 *   authorized refresh path: it still rewrites the row, because the point of a refresh
 *   is that the next ordinary visitor gets the rebuilt body too, not just this caller.
 * @param options.bypassCacheControl - Header value when bypassing; a refresh response
 *   must not be cacheable.
 */
export const serveCachedJson = async (
  res: Response,
  options: {
    cacheKey: string
    build: () => Promise<string>
    cacheControl: string
    bypassCache?: boolean
    bypassCacheControl?: string
  },
): Promise<void> => {
  const { cacheKey, build, cacheControl, bypassCache = false, bypassCacheControl } = options
  const cached = bypassCache ? null : await db.getCachedRequest(cacheKey)
  if (cached) {
    res.set('cache-control', cacheControl)
    res.set('content-type', 'application/json')
    res.send(cached.value)
    if (cacheRowAge(cached) > FRESH_TTL_MS) {
      buildAndCache(cacheKey, build).catch((err: unknown) =>
        log('background revalidate failed for %s: %o', cacheKey, err),
      )
    }
    return
  }
  const body = await buildAndCache(cacheKey, build)
  res.set('cache-control', bypassCache && bypassCacheControl ? bypassCacheControl : cacheControl)
  res.set('content-type', 'application/json')
  res.send(body)
}
