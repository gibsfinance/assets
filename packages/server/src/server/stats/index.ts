import createError from 'http-errors'
import { cacheResult } from '@gibs/utils'
import { Router } from 'express'
import { nextOnError } from '../utils'
import { refreshRequest, REFRESH_CACHE_CONTROL, type RefreshQuery } from '../cache-refresh'
import config from '../../../config'
import { fromCAIP2 } from '../../chain-id'
import * as db from '../../db'

export const router = Router() as Router

type Result = {
  chainId: string
  count: number
}

/**
 * Returns token counts per chain for the network selector.
 * Uses a lightweight COUNT(DISTINCT) query instead of loading all tokens.
 */
export const getStats = cacheResult<Result[]>(async () => {
  return db.getTokenCountsByChain()
})

router.get(
  '/',
  nextOnError<unknown, unknown, unknown, RefreshQuery>(async (req, res, next) => {
    const refresh = refreshRequest({
      refreshParam: req.query.refresh,
      authorizationHeader: req.headers.authorization,
      adminToken: config.adminToken,
    })
    // Reject rather than ignore: a refresh that silently returns the cached counts
    // would read as confirmation that a deploy landed when it has not.
    if (refresh.requested && !refresh.authorized) {
      return next(createError.Unauthorized('unauthorized'))
    }
    // Counts move as collection runs, but the memo pins them for an hour — drop it
    // so the rebuilt response reflects what is actually in the database right now.
    if (refresh.authorized) getStats.reset()
    const counts = await getStats()
    res.set('cache-control', refresh.authorized ? REFRESH_CACHE_CONTROL : `public, max-age=${config.cacheSeconds}`)
    // chainId = bare number for backwards compat, chainIdentifier = CAIP-2
    res.send(
      counts.map((r) => ({
        chainId: fromCAIP2(r.chainId),
        chainIdentifier: r.chainId,
        count: r.count,
      })),
    )
  }),
)
