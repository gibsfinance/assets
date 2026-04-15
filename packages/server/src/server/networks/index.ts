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

router.get(
  '/',
  nextOnError(async (_req, res) => {
    const networks = await getNetworks()
    res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
    // Return bare chainId for backwards compat, add chainIdentifier
    res.json(
      networks.map((n) => ({
        ...n,
        chainId: fromCAIP2(n.chainId),
        chainIdentifier: n.chainId,
      })),
    )
  }),
)
