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
import { eq, and, asc, inArray, sql as dsql } from 'drizzle-orm'
import * as s from '../../db/schema'
import { getDefaultListOrderId } from '../../db/sync-order'

export const merged: RequestHandler = async (req, res, next) => {
  const extensions = getExtensions(req)
  const orderId = await db.getListOrderId(req.params.order)
  if (!orderId) {
    return next(createError.NotFound('order id missing'))
  }
  const chainId = req.query.chainId as string | undefined
  const whereClause = chainId
    ? and(dsql`${s.network.chainId} != '0'`, eq(s.network.chainId, chainId))!
    : dsql`${s.network.chainId} != '0'`
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
export const tokensByChain: RequestHandler = async (req, res, next) => {
  const chainId = req.params.chainId
  if (!chainId || !/^\d+$/.test(chainId)) return next(createError.BadRequest('valid numeric chainId required'))

  const limit = Math.min(Number(req.query.limit) || 50_000, 100_000)
  const extensions = getExtensions(req)

  const defaultOrderId = getDefaultListOrderId()

  // Run both queries in parallel — they share no dependencies
  const drizzle = getDrizzle()
  const tokensPromise = defaultOrderId
    ? db.getTokensByChain(defaultOrderId, chainId)
    : db.getTokensUnderListId().where(eq(s.network.chainId, chainId)).orderBy(asc(s.image.ext), asc(s.listToken.listTokenOrderId))

  const sourcesPromise = drizzle
    .select({
      providedId: s.token.providedId,
      providerKey: s.provider.key,
      listKey: s.list.key,
    })
    .from(s.token)
    .innerJoin(s.network, eq(s.network.networkId, s.token.networkId))
    .innerJoin(s.listToken, eq(s.listToken.tokenId, s.token.tokenId))
    .innerJoin(s.list, eq(s.list.listId, s.listToken.listId))
    .innerJoin(s.provider, eq(s.provider.providerId, s.list.providerId))
    .where(eq(s.network.chainId, chainId))

  const [tokens, sourceRows] = await Promise.all([tokensPromise, sourcesPromise])

  const filters = utils.tokenFilters(req.query)
  const entries = utils.normalizeTokens(tokens as any, filters, extensions)

  const sourcesByAddress = new Map<string, Set<string>>()
  for (const row of sourceRows) {
    const key = row.providedId.toLowerCase()
    let set = sourcesByAddress.get(key)
    if (!set) {
      set = new Set()
      sourcesByAddress.set(key, set)
    }
    set.add(`${row.providerKey}/${row.listKey}`)
  }

  for (const entry of entries) {
    const sources = sourcesByAddress.get(entry.address.toLowerCase())
    if (sources) entry.sources = [...sources]
  }

  const limited = entries.slice(0, limit)

  res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  res.json({
    chainId: +chainId,
    total: entries.length,
    tokens: limited,
  })
}
