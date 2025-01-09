import createError from 'http-errors'
import * as db from '@/db'
import { Request, RequestHandler } from 'express'
import * as utils from './utils'
import { tableNames } from '@/db/tables'
import type { Image, ListToken } from 'knex/types/tables'
import _ from 'lodash'

export const merged: RequestHandler = async (req, res, next) => {
  const extensions = getExtensions(req)
  const orderId = await db.getListOrderId(req.params.order)
  if (!orderId) {
    return next(createError.NotFound())
  }
  const listTokens = db
    .getDB()
    .select<ListToken & Image>([
      `${tableNames.token}.provided_id`,
      `${tableNames.token}.name`,
      `${tableNames.token}.symbol`,
      `${tableNames.token}.decimals`,
      `${tableNames.network}.chain_id`,
      `${tableNames.image}.image_hash`,
      `${tableNames.image}.ext`,
    ])
    .from(tableNames.listToken)
    .join(tableNames.token, {
      [`${tableNames.token}.token_id`]: `${tableNames.listToken}.token_id`,
    })
    .join(tableNames.network, {
      [`${tableNames.network}.network_id`]: `${tableNames.token}.network_id`,
    })
    .join(tableNames.image, {
      [`${tableNames.image}.image_hash`]: `${tableNames.listToken}.image_hash`,
    })
  const tokens = await db.applyOrder(listTokens, orderId).where(`chain_id`, '!=', 0)
  const filters = utils.tokenFilters(req.query)
  const entries = utils.normalizeTokens(tokens, filters, extensions)
  res.json(utils.minimalList(entries))
}

const getExtensions = (req: Request) => {
  const extensions = req.query.extensions
  if (!extensions) return new Set<string>()
  if (_.isArray(extensions)) return new Set(extensions as string[])
  return new Set([extensions as string])
}

export const versioned: RequestHandler = async (req, res, next) => {
  const extensions = getExtensions(req)
  const unversionedList = db.getLists(req.params.providerKey, req.params.listKey)
  const list = await utils.applyVersion(req.params.version, unversionedList).first()
  if (!list) {
    return next(createError.NotFound())
  }
  const filters = utils.tokenFilters(req.query)
  await utils.respondWithList(res, list, filters, extensions)
}

export const providerKeyed: RequestHandler = async (req, res, next) => {
  const extensions = getExtensions(req)
  const list = await db.getLists(req.params.providerKey, req.params.listKey).first()
  if (!list) {
    return next(createError.NotFound())
  }
  const filters = utils.tokenFilters(req.query)
  await utils.respondWithList(res, list, filters, extensions)
}
