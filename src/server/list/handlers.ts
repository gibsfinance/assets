import createError from 'http-errors'
import * as db from '@/db'
import { RequestHandler } from 'express'
import * as utils from './utils'
import { tableNames } from '@/db/tables'
import type { Image, ListToken } from 'knex/types/tables'

export const merged: RequestHandler = async (req, res, next) => {
  const orderId = await db.getListOrderId(req.params.order)
  if (!orderId) {
    return next(createError.NotFound())
  }
  const listTokens = db.getDB().select<ListToken & Image>('*').from(tableNames.listToken)
  const tokens = await db
    .applyOrder(listTokens, orderId)
    .join(tableNames.token, {
      [`${tableNames.token}.token_id`]: `${tableNames.listToken}.token_id`,
    })
    .join(tableNames.network, {
      [`${tableNames.network}.network_id`]: `${tableNames.token}.network_id`,
    })
  const filters = utils.tokenFilters(req.query)
  const entries = utils.normalizeTokens(tokens, filters)
  res.json(utils.minimalList(entries))
}

export const versioned: RequestHandler = async (req, res, next) => {
  const list = await utils
    .applyVersion(req.params.version, db.getLists(req.params.providerKey, req.params.listKey))
    .first()
  if (!list) {
    return next(createError.NotFound())
  }
  const filters = utils.tokenFilters(req.query)
  await utils.respondWithList(res, list, filters)
}

export const providerKeyed: RequestHandler = async (req, res, next) => {
  const list = await db.getLists(req.params.providerKey, req.params.listKey).first()
  if (!list) {
    return next(createError.NotFound())
  }
  const filters = utils.tokenFilters(req.query)
  await utils.respondWithList(res, list, filters)
}

export const bridgeProviderKeyed: RequestHandler = async (req, res, next) => {
  const list = await db.getLists(`${req.params.providerKey}-bridge`, req.params.listKey).first()
  if (!list) {
    return next(createError.NotFound())
  }
  const filters = utils.tokenFilters(req.query)
  await utils.respondWithList(res, list, filters)
}
