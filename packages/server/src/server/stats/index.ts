import { cacheResult } from '@gibs/utils'
import { Router } from 'express'
import { nextOnError } from '../utils'
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
  nextOnError(async (_req, res) => {
    const counts = await getStats()
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
