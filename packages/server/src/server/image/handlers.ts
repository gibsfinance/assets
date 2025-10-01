import * as viem from 'viem'
import httpErrors, { HttpError } from 'http-errors'
import * as path from 'path'
import { tableNames } from '../../db/tables'
import type { ChainId } from '@gibs/utils'
import * as utils from '../../utils'
import * as db from '../../db'
import config from '../../../config'
import { Image, ListOrder, ListOrderItem, ListToken, List, Token } from 'knex/types/tables'
import { RequestHandler, Response } from 'express'
import _ from 'lodash'
import { ParsedQs } from 'qs'
import { submodules } from '../../paths'

export const getListTokens = async ({ chainId, address, listOrderId, exts, providerKey, listKey }: {
  chainId: ChainId,
  address: viem.Hex,
  listOrderId?: viem.Hex | null,
  exts?: string[],
  providerKey?: string[],
  listKey?: string[],
}) => {
  const filter = {
    [`${tableNames.token}.networkId`]: utils.chainIdToNetworkId(chainId),
    [`${tableNames.token}.providedId`]: viem.getAddress(address),
  }
  // if (providerKey) {
  //   filter[`${tableNames.provider}.key`] = providerKey
  // }
  // if (listKey) {
  //   filter[`${tableNames.list}.key`] = listKey
  // }
  let q = db
    .getDB()
    .select('*')
    .from(tableNames.listToken)
    .join(`${config.database.schema}.${tableNames.provider}`, {
      [`${tableNames.provider}.providerId`]: `${tableNames.list}.providerId`,
    })
    .join(`${config.database.schema}.${tableNames.list}`, {
      [`${tableNames.list}.listId`]: `${tableNames.listToken}.listId`,
    })
    .join(`${config.database.schema}.${tableNames.token}`, {
      [`${tableNames.token}.tokenId`]: `${tableNames.listToken}.tokenId`,
    })
    .join(`${config.database.schema}.${tableNames.image}`, {
      [`${tableNames.image}.imageHash`]: `${tableNames.listToken}.imageHash`,
    })
    .where(filter)
  if (exts?.length) {
    q = q.whereIn('ext', exts)
  }
  if (providerKey?.length) {
    q = q.whereIn(`${tableNames.provider}.key`, providerKey)
  }
  if (listKey?.length) {
    q = q.whereIn(`${tableNames.list}.key`, listKey)
  }
  if (listOrderId) {
    q = db.applyOrder(q, listOrderId) //
    // .join(tableNames.list, {
    //   [`${tableNames.listToken}.listId`]: `${tableNames.list}.listId`,
    // })
  }
  return {
    filter,
    img: await q.first<Image & Token & ListOrder & ListOrderItem & ListToken & List>(),
  }
}

export const getNetworkIcon = async (chainId: ChainId, exts?: string[]) => {
  const filter = {
    networkId: utils.chainIdToNetworkId(chainId),
  }
  let q = db
    .getDB()
    .select<Image>('*')
    .from(tableNames.image)
    .join(`${config.database.schema}.${tableNames.network}`, {
      [`${tableNames.network}.imageHash`]: `${tableNames.image}.imageHash`,
    })
    .where(filter)
  if (exts?.length) {
    q = q.whereIn('ext', exts)
  }
  return {
    filter,
    img: await q.first(),
  }
}

type FilenameParts = {
  filename: string
  ext?: string
  exts?: string[]
}

export const extFilter = new Map<string, string[]>([
  ['.raster', ['.png', '.jpg', '.jpeg', '.webp', '.gif']],
  ['.vector', ['.svg', '.xml']],
])

export const splitExt = (filename: string): FilenameParts => {
  const ext = path.extname(filename)
  if (!ext) {
    return {
      filename,
    }
  }
  const exts = extFilter.get(ext) || [ext]
  return {
    filename: filename.split(ext).join(''),
    ext,
    exts,
  }
}

const getListImage =
  (parseOrder: boolean) =>
    async ({
      chainId,
      address: addressParam,
      order: orderParam,
      providerKey,
      listKey,
    }: {
      chainId: number
      address: string
      order?: string
      providerKey?: string[],
      listKey?: string[],
    }) => {
      if (!+chainId) {
        throw httpErrors.BadRequest('chainId')
      }
      const { filename: address, exts } = splitExt(addressParam)
      if (!viem.isAddress(address)) {
        throw httpErrors.BadRequest('address')
      }
      const listOrderId = parseOrder && orderParam ? await db.getListOrderId(orderParam as string) : null
      const { img } = await getListTokens({
        chainId: +chainId,
        address,
        listOrderId,
        exts,
        providerKey,
        listKey,
      })
      if (!img) {
        throw httpErrors.NotFound('list image missing')
      }
      return img
    }

const queryStringToList = (query: string | ParsedQs | (string | ParsedQs)[] | undefined) => {
  if (!query) {
    return []
  }
  if (_.isString(query)) {
    return [...query.split(',')].filter((v) => v.trim())
  }
  if (Array.isArray(query)) {
    return _.map(query, (v) => v.toString())
  }
  return query.toString().split(',').filter((v) => v.trim())
}

export const getImage =
  (parseOrder: boolean): RequestHandler =>
    async (req, res) => {
      const img = await getListImage(parseOrder)({
        chainId: Number(req.params.chainId),
        address: req.params.address as viem.Hex,
        order: req.params.order,
        providerKey: queryStringToList(req.query.providerKey),
        listKey: queryStringToList(req.query.listKey),
      })
      sendImage(res, img)
    }

export const getImageAndFallback: RequestHandler = async (req, res) => {
  const providerKey = queryStringToList(req.query.providerKey)
  const listKey = queryStringToList(req.query.listKey)
  let img = await getListImage(true)({
    chainId: Number(req.params.chainId),
    address: req.params.address as viem.Hex,
    order: req.params.order,
    providerKey,
    listKey,
  }).catch(ignoreNotFound)
  if (!img) {
    img = await getListImage(false)({
      chainId: Number(req.params.chainId),
      address: req.params.address as viem.Hex,
      providerKey,
      listKey,
    })
  }
  sendImage(res, img)
}

export const getImageByHash: RequestHandler = async (req, res, next) => {
  const { filename, exts } = splitExt(req.params.imageHash)
  const img = await db
    .getDB()
    .select('*')
    .from(tableNames.image)
    .where('imageHash', filename)
    .whereIn('ext', exts as string[])
    .first()
  if (!img) {
    return next(httpErrors.NotFound('image not found'))
  }
  sendImage(res, img)
}

const bestGuessNeworkImage = async (chainIdParam: string) => {
  const { filename: chainId, exts } = splitExt(chainIdParam)
  if (!+chainId) {
    throw httpErrors.BadRequest('chainId')
  }
  const { img } = await getNetworkIcon(+chainId, exts)
  if (!img) {
    throw httpErrors.NotFound('best guess network image not found')
  }
  return img
}

export const bestGuessNetworkImageFromOnOnChainInfo: RequestHandler = async (req, res) => {
  const img = await bestGuessNeworkImage(req.params.chainId)
  sendImage(res, img)
}

const ignoreNotFound = (err: HttpError) => {
  if (err.status === 404) {
    return null
  }
  throw err
}

export type KeyFilterQuery = {
  providerKey: string | string[]
  listKey: string | string[]
}

export const tryMultiple: RequestHandler<any, any, any, { i: string | string[] } & KeyFilterQuery> = async (req, res, next) => {
  const { i } = req.query
  let images: string[] = []
  if (Array.isArray(i)) images = i.map((i) => i.toString())
  else if (i) {
    images = [i.toString()]
  }
  for (const i of images) {
    if (!_.isString(i)) {
      return next(httpErrors.NotAcceptable('invalid i'))
    }
    const [chainId, address, order] = i.split('/')
    if (!address) {
      const img = await bestGuessNeworkImage(chainId).catch(ignoreNotFound)
      if (!img) continue
      return sendImage(res, img)
    }
    if (order && order.length !== 64 /* check if hex */) {
      return next(httpErrors.NotAcceptable('invalid order'))
    }
    const providerKey = queryStringToList(req.query.providerKey)
    const listKey = queryStringToList(req.query.listKey)
    let img = await getListImage(true)({
      chainId: Number(chainId),
      address,
      order,
      providerKey,
      listKey,
    }).catch(ignoreNotFound)
    if (!img) {
      img = await getListImage(false)({
        chainId: Number(chainId),
        address,
        providerKey,
        listKey,
      }).catch(ignoreNotFound)
    }
    if (img) {
      return sendImage(res, img)
    }
  }
  return next(httpErrors.NotFound('image not found from list'))
}

export const sendImage = (res: Response, img: Image) => {
  let r = res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  if (img.uri) {
    if (img.uri.startsWith('http') || img.uri.startsWith('ipfs')) {
      r = r.set('x-uri', img.uri)
    } else if (img.uri.startsWith('data:')) {
      // encoded data - no uri available
    } else {
      r = r.set('x-uri', path.relative(submodules, img.uri))
    }
  }
  r.contentType(img.ext).send(img.content)
}
