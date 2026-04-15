import { cacheResult } from '@gibs/utils'
import { Router } from 'express'
import { nextOnError } from '../utils'
import { getDrizzle } from '../../db/drizzle'
import { sql as dsql, eq } from 'drizzle-orm'
import { fromCAIP2 } from '../../chain-id'
import * as s from '../../db/schema'

export const router = Router() as Router

type Result = {
  chainId: string
  count: number
}

export const getStats = cacheResult<Result[]>(async () => {
  // Updated to match the logic in buildTokensByChainResponse() + normalizeTokens()
  // This ensures the network selector counts match what the token browser displays
  const rows = await getDrizzle()
    .select({
      chainId: s.network.chainId,
      count: dsql<number>`count(distinct lower(${s.token.providedId}))`,
    })
    .from(s.network)
    .innerJoin(s.token, eq(s.token.networkId, s.network.networkId))
    .innerJoin(s.listToken, eq(s.listToken.tokenId, s.token.tokenId))
    // Only count tokens that would appear in the token browser
    // This matches the filtering done in buildTokensByChainResponse() and the UI
    .where(dsql`(${s.listToken.imageHash} IS NOT NULL OR ${s.list.default} = true)`)
    .groupBy(s.network.chainId)
    .orderBy(dsql`count(distinct lower(${s.token.providedId})) DESC`)
  return rows as unknown as Result[]
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
