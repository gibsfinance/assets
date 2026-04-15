import { cacheResult } from '@gibs/utils'
import { Router } from 'express'
import { nextOnError } from '../utils'
import { fromCAIP2 } from '../../chain-id'
import { buildTokensByChainResponse } from '../list/handlers'

export const router = Router() as Router

type Result = {
  chainId: string
  count: number
}

/**
 * Returns token counts per chain for the network selector.
 * Uses the same underlying function as the token browser to guarantee identical counts.
 * This ensures the network selector buttons and "search n tokens..." input always match.
 */
export const getStats = cacheResult<Result[]>(async () => {
  const defaultLimit = 100000
  const extensions = new Set<string>()

  const chainIds = ['1', '369', '56', '8453', '943', '137', '10', '42161']
  const counts = await Promise.all(
    chainIds.map(async (rawChainId) => {
      const chainId = rawChainId.includes('-') ? rawChainId : `eip155-${rawChainId}`
      const body = await buildTokensByChainResponse(chainId, defaultLimit, extensions)
      const parsed = JSON.parse(body)
      return {
        chainId: rawChainId,
        count: parsed.total,
      }
    }),
  )

  return counts.sort((a, b) => b.count - a.count) as Result[]
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
