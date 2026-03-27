import { cacheResult } from '@gibs/utils'
import { Router } from 'express'
import { nextOnError } from '../utils'
import * as db from '../../db'
import * as utils from '../list/utils'
import { eq, and, asc, isNotNull } from 'drizzle-orm'
import * as s from '../../db/schema'

export const router = Router() as Router

type Result = {
  chainId: string
  count: number
}

const getStats = cacheResult<Result[]>(async () => {
  const tokens = await db
    .getTokensUnderListId()
    .where(isNotNull(s.listToken.imageHash))
    .orderBy(asc(s.image.ext), asc(s.listToken.listTokenOrderId))

  const entries = utils.normalizeTokens(tokens as any)
  const byChain = new Map<number, number>()
  for (const entry of entries) {
    byChain.set(entry.chainId, (byChain.get(entry.chainId) ?? 0) + 1)
  }
  return [...byChain.entries()]
    .map(([chainId, count]) => ({ chainId: String(chainId), count }))
    .sort((a, b) => b.count - a.count)
})

router.get(
  '/',
  nextOnError(async (_req, res) => {
    const counts = await getStats()
    res.send(counts)
  }),
)
