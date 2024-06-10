import { Router } from 'express'
import * as db from '@/db'
import createError from 'http-errors'
import * as data from '@/server/data'
import { request } from 'http'
import { tableNames } from '@/db/tables'
import config from 'config'
import { List } from 'knex/types/tables'

export const router = Router()

router.get('/all', async (_req, res, _next) => {
  res.json(data.allTokenLists)
})

// router.get('/:providerKey', async (req, res, next) => {
//   // const listLink = data.providerToListLink().get(req.params.providerKey)
//   // if (!listLink) {
//   //   return next(createError.NotFound())
//   // }
//   // req.pipe(request(listLink)).pipe(res)
// })

router.get('/:providerKey/:listKey?', async (req, res, next) => {
  const list = await db.getDB().from(tableNames.provider)
    .select<List[]>('*')
    .join(tableNames.list, {
      [`${tableNames.list}.providerId`]: `${tableNames.provider}.providerId`,
    })
    .join(tableNames.listToken, {
      [`${tableNames.list}.listId`]: `${tableNames.listToken}.listId`,
    })
    .where({
      [`${tableNames.provider}.key`]: req.params.providerKey,
      [`${tableNames.list}.key`]: req.params.listKey || 'default',
    })
    .orderBy('major', 'desc')
    .orderBy('minor', 'desc')
    .orderBy('patch', 'desc')
    .first()
  if (!list) {
    return next(createError.NotFound())
  }
  const tokens = await db.getTokensUnderListId(list.listId)

  // .groupBy([
  //   `${tableNames.list}.listId`,
  // ])
  /*

  .where(`${tableNames.listOrderItem}.listOrderId`, listOrderId)
  .denseRank('rank', function denseRankByConfiged() {
    return this.orderBy(`${tableNames.listOrderItem}.ranking`, 'asc')
      .orderBy(`${tableNames.list}.major`, 'desc')
      .orderBy(`${tableNames.list}.minor`, 'desc')
      .orderBy(`${tableNames.list}.patch`, 'desc')
      .partitionBy([
        `${tableNames.listToken}.networkId`,
        `${tableNames.listToken}.providedId`,
      ])
  })
return t('ls')
  .with('ls', qSub)
  .select('ls.*')
  .where('ls.rank', 1)
   */
  res.json({
    name: list.name,
    description: list.description,
    // logoURI: list.logoURI,
    version: {
      major: list.major,
      minor: list.minor,
      patch: list.patch,
    },
    timestamp: list.updatedAt,
    tokens: tokens.map((tkn) => ({
      chainId: tkn.chainId,
      address: tkn.address,
      name: tkn.name,
      symbol: tkn.symbol,
      decimals: tkn.decimals,
      logoURI: `${config.rootURI}/image/direct/${tkn.imageHash}${tkn.ext}`,
    }))
  })
})
