import createError from 'http-errors'
import * as viem from 'viem'
import config from 'config'
import * as db from '@/db'
import { RequestHandler } from "express"
import * as utils from './utils'
import { tableNames } from '@/db/tables'
import { Image, ListToken } from 'knex/types/tables'

export const merged: RequestHandler = async (req, res, next) => {
  const orderId = await db.getListOrderId(req.params.order)
  if (!orderId) {
    return next(createError.NotFound())
  }
  const listTokens = db.getDB().select<ListToken & Image>('*')
    .from(tableNames.listToken)
  const tokens = await db.applyOrder(listTokens, orderId)
    .join(tableNames.token, {
      [`${tableNames.token}.network_id`]: `${tableNames.listToken}.network_id`,
      [`${tableNames.token}.provided_id`]: `${tableNames.listToken}.provided_id`,
    })
    .join(tableNames.network, {
      [`${tableNames.network}.network_id`]: `${tableNames.listToken}.network_id`,
    })
  // const tokens = await db.applyOrder(db.getDB().select<ListToken & Image>('*')
  //   .from(tableNames.listToken), orderId).with('a', (qb) => (
  //     db.getTokensUnderListId(qb)
  //   ))
  // if (exts?.length) {
  //   q = q.whereIn('ext', exts)
  // }
  // const lists = await db.getListTokensUnderOrder(req.params.order)
  //   .join(`${tableNames.token}`, {
  //     [`${tableNames.listToken}.network_id`]: `${tableNames.token}.network_id`,
  //     [`${tableNames.listToken}.provided_id`]: `${tableNames.token}.provided_id`,
  //   })
  // if (!lists.length) {
  //   return next(createError.NotFound())
  // }
  res.json({
    name: 'Merged',
    description: 'A merged list',
    timestamp: (new Date()).toISOString(),
    version: {
      major: 0,
      minor: 0,
      patch: 0,
    },
    tokens: utils.normalizeTokens(tokens),
  })
}

export const versioned: RequestHandler = async (req, res, next) => {
  const list = await utils.applyVersion(req.params.version, db.getLists(
    req.params.providerKey,
    req.params.listKey
  )).first()
  if (!list) {
    return next(createError.NotFound())
  }
  await utils.respondWithList(res, list)
}

export const providerKeyed: RequestHandler = async (req, res, next) => {
  console.log(req.params)
  const list = await db.getLists(
    req.params.providerKey,
    req.params.listKey
  ).first()
  if (!list) {
    return next(createError.NotFound())
  }
  await utils.respondWithList(res, list)
}
