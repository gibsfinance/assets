import { Router } from 'express'
import { cacheResult } from '@gibs/utils'
import type { Network } from '../../db/schema-types'
import { nextOnError } from '../utils'
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
  imageHash: n.imageHash,
})

router.get(
  '/',
  nextOnError(async (_req, res) => {
    const networks = await getNetworks()
    res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
    // The asset-0 sentinel row is internal bookkeeping — /stats already
    // excludes it, so exclude it here too for consistency.
    res.json(networks.filter((n) => n.chainId !== 'asset-0').map(toPublicNetwork))
  }),
)
