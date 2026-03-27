import { cacheResult } from '@gibs/utils'
import { Router } from 'express'
import { nextOnError } from '../utils'
import * as db from '../../db'
import * as utils from '../list/utils'
import { asc, isNotNull } from 'drizzle-orm'
import * as s from '../../db/schema'

export const router = Router() as Router

type Result = {
  chainId: string
  count: number
  topList?: string
}

const getStats = cacheResult<Result[]>(async () => {
  const tokens = await db
    .getTokensUnderListId()
    .where(isNotNull(s.listToken.imageHash))
    .orderBy(asc(s.image.ext), asc(s.listToken.listTokenOrderId))

  const entries = utils.normalizeTokens(tokens as any)

  // Per-chain: token count + which list contributes the most tokens
  const byChain = new Map<number, { count: number; listCounts: Map<string, number> }>()
  for (const entry of entries) {
    let chain = byChain.get(entry.chainId)
    if (!chain) {
      chain = { count: 0, listCounts: new Map() }
      byChain.set(entry.chainId, chain)
    }
    chain.count++
    if ('sources' in entry && entry.sources) {
      for (const src of entry.sources) {
        chain.listCounts.set(src, (chain.listCounts.get(src) ?? 0) + 1)
      }
    }
  }

  return [...byChain.entries()]
    .map(([chainId, { count, listCounts }]) => {
      let topList: string | undefined
      let topCount = 0
      for (const [list, c] of listCounts) {
        if (c > topCount) {
          topCount = c
          topList = list
        }
      }
      return { chainId: String(chainId), count, topList }
    })
    .sort((a, b) => b.count - a.count)
})

router.get(
  '/',
  nextOnError(async (_req, res) => {
    const counts = await getStats()
    res.send(counts)
  }),
)
