import createError from 'http-errors'
import { Router } from 'express'
import { cacheResult } from '@gibs/utils'
import type { Network } from '../../db/schema-types'
import { nextOnError } from '../utils'
import { refreshRequest, REFRESH_CACHE_CONTROL, type RefreshQuery } from '../cache-refresh'
import config from '../../../config'
import { fromCAIP2 } from '../../chain-id'
import { getDrizzle } from '../../db/drizzle'
import * as s from '../../db/schema'

export const router = Router() as Router

const getNetworks = cacheResult<Network[]>(async () => {
  return await getDrizzle().select().from(s.network)
})

/**
 * Map a network row to its public response shape. Fields are picked
 * explicitly so internal columns (createdAt/updatedAt) never leak.
 */
export const toPublicNetwork = (n: Network) => ({
  networkId: n.networkId,
  type: n.type,
  // Bare chainId (string) for backwards compat, chainIdentifier is prefixed
  chainId: fromCAIP2(n.chainId),
  chainIdentifier: n.chainId,
  // Registry display name, null when no collector had one to write. Clients keep
  // their own fallback map, so this supplements their naming rather than replacing it.
  name: n.name,
  // The registry's prose label. Not for display — clients classify testnets from it,
  // since it is where a codename-named testnet ("Adiri") states what it is.
  title: n.title,
  imageHash: n.imageHash,
})

router.get(
  '/',
  nextOnError<unknown, unknown, unknown, RefreshQuery>(async (req, res, next) => {
    const refresh = refreshRequest({
      refreshParam: req.query.refresh,
      authorizationHeader: req.headers.authorization,
      adminToken: config.adminToken,
    })
    // Fail loudly rather than quietly serving the cached body — an operator who
    // thinks they verified a deploy against fresh data, but did not, is worse off
    // than one who is told their token was rejected.
    if (refresh.requested && !refresh.authorized) {
      return next(createError.Unauthorized('unauthorized'))
    }
    // The memo is process-local and holds for an hour by default, so a deploy that
    // changes network rows is invisible until it lapses. Drop it before reading.
    if (refresh.authorized) getNetworks.reset()
    const networks = await getNetworks()
    res.set('cache-control', refresh.authorized ? REFRESH_CACHE_CONTROL : `public, max-age=${config.cacheSeconds}`)
    // The asset-0 sentinel row is internal bookkeeping — /stats already
    // excludes it, so exclude it here too for consistency.
    res.json(networks.filter((n) => n.chainId !== 'asset-0').map(toPublicNetwork))
  }),
)
