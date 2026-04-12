import { cacheResult } from '@gibs/utils'
import { Router } from 'express'
import { nextOnError } from '../utils'
import { getDrizzle } from '../../db/drizzle'
import { sql as dsql, eq } from 'drizzle-orm'
import * as s from '../../db/schema'

export const router = Router() as Router

type Result = {
  chainId: string
  count: number
}

export const getStats = cacheResult<Result[]>(async () => {
  const rows = await getDrizzle()
    .select({
      chainId: s.network.chainId,
      count: dsql<number>`count(distinct lower(${s.token.providedId}))`,
    })
    .from(s.network)
    .innerJoin(s.token, eq(s.token.networkId, s.network.networkId))
    .innerJoin(s.listToken, eq(s.listToken.tokenId, s.token.tokenId))
    .innerJoin(s.image, eq(s.image.imageHash, s.listToken.imageHash))
    .groupBy(s.network.chainId)
    .orderBy(dsql`count(distinct lower(${s.token.providedId})) DESC`)
  return rows as unknown as Result[]
})

router.get(
  '/',
  nextOnError(async (_req, res) => {
    const counts = await getStats()
    res.send(counts)
  }),
)
