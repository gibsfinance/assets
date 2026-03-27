import createError from 'http-errors'
import * as db from '../../db'
import type { Request, RequestHandler } from 'express'
import * as utils from './utils'
import _ from 'lodash'
import config from '../../../config'
import { bumpSubscriberCount } from '../../collect/user-submissions'
import { getDrizzle } from '../../db/drizzle'
import { eq, and, asc, inArray, isNotNull, sql as dsql } from 'drizzle-orm'
import * as s from '../../db/schema'
import { getDefaultListOrderId } from '../../db/sync-order'

export const merged: RequestHandler = async (req, res, next) => {
  const extensions = getExtensions(req)
  const orderId = await db.getListOrderId(req.params.order)
  if (!orderId) {
    return next(createError.NotFound('order id missing'))
  }
  const whereClause = dsql`${s.network.chainId} != '0'`
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
      String(row.list?.major) === major &&
      String(row.list?.minor) === minor &&
      String(row.list?.patch) === patch,
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
    bumpSubscriberCount(providerKey).catch(() => {})
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

  const whereClause = eq(s.network.chainId, chainId)
  const defaultOrderId = getDefaultListOrderId()

  // Use applyOrder when available so tokens from higher-ranked lists appear first
  // dedupe: false returns all rows so normalizeTokens can collect all sources per token
  const tokens = defaultOrderId
    ? await db.applyOrder(defaultOrderId, whereClause, 'listToken', undefined, { dedupe: false })
    : await db
        .getTokensUnderListId()
        .where(whereClause)
        .orderBy(asc(s.image.ext), asc(s.listToken.listTokenOrderId))

  const filters = utils.tokenFilters(req.query)
  const entries = utils.normalizeTokens(tokens as any, filters, extensions)
  const limited = entries.slice(0, limit)

  res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  res.json({
    chainId: +chainId,
    total: entries.length,
    tokens: limited,
  })
}
