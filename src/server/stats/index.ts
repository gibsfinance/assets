import { getDB } from '@/db'
import { tableNames } from '@/db/tables'
import { cacheResult } from '@/utils'
import { Router } from 'express'
import _ from 'lodash'

const db = getDB()

export const router = Router() as Router

type Result = {
  chainId: string
  count: number
}

const getStats = cacheResult<Result[]>(async () => {
  const counts = await db
    .select([
      'network.chainId', //
      db.raw('count(distinct(network.network_id, lower(token.token_id))) as count'),
    ])
    .from(tableNames.network)
    .innerJoin(tableNames.token, 'network.network_id', 'token.network_id')
    .innerJoin(tableNames.listToken, 'token.tokenId', 'listToken.tokenId')
    .whereNotNull('listToken.imageHash')
    .groupBy('network.chainId')
    .orderBy('count', 'desc')
  return counts
})

router.get('/', async (_req, res) => {
  const counts = await getStats()
  res.send(counts)
})
