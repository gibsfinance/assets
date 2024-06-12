import * as viem from 'viem'
import httpErrors from 'http-errors'
import * as path from 'path'
import { Tx, tableNames } from "@/db/tables"
import { ChainId } from "@/types"
import * as utils from '@/utils'
import * as db from '@/db'
import config from 'config'
import { Image, ListOrder, ListToken } from 'knex/types/tables'
import { Knex } from 'knex'
import { RequestHandler, Response } from 'express'

export const getListTokens = async (
  chainId: ChainId, address: viem.Hex,
  listOrderId?: viem.Hex | null, exts?: string[],
) => {
  const filter = {
    [`${tableNames.listToken}.networkId`]: utils.chainIdToNetworkId(chainId),
    [`${tableNames.listToken}.providedId`]: viem.getAddress(address),
  }
  let q = db.getDB().select<ListToken & Image>('*')
    .from(tableNames.listToken)
    .join(`${config.database.schema}.${tableNames.image}`, {
      [`${tableNames.image}.imageHash`]: `${tableNames.listToken}.imageHash`,
    })
    .where(filter)
  if (exts?.length) {
    q = q.whereIn('ext', exts)
  }
  if (listOrderId) {
    q = applyOrder(q, listOrderId)
  }
  return {
    filter,
    img: await q.first(),
  }
}

export const applyOrder = (
  q: Knex.QueryBuilder, listOrderId: viem.Hex,
  t: Tx = db.getDB(),
): Knex.QueryBuilder => {
  const qSub = q.join(tableNames.list, {
    [`${tableNames.list}.listId`]: `${tableNames.listToken}.listId`,
  })
    .fullOuterJoin(tableNames.listOrderItem, {
      [`${tableNames.listOrderItem}.listKey`]: `${tableNames.list}.key`,
      [`${tableNames.listOrderItem}.providerId`]: `${tableNames.list}.providerId`,
    })
    .join(tableNames.listOrder, {
      [`${tableNames.listOrder}.listOrderId`]: `${tableNames.listOrderItem}.listOrderId`,
    })
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
}

export const getNetworkIcon = async (chainId: ChainId, exts?: string[]) => {
  const filter = {
    networkId: utils.chainIdToNetworkId(chainId),
  }
  let q = db.getDB().select<Image>('*')
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

export const getListOrderId = async (orderParam: string) => {
  let listOrderId: viem.Hex | null = null
  if (orderParam) {
    if (viem.isHex(orderParam)) {
      // presume that this is the list order id
      orderParam = orderParam as viem.Hex
    } else if (viem.isHex(`0x${orderParam}`)) {
      orderParam = `0x${orderParam}` as viem.Hex
      // presume that it is the list order key
    }
    if (orderParam && viem.toHex(viem.toBytes(orderParam), { size: 32 }).slice(2) !== orderParam) {
      // assume only a fragment is being given
      const listOrder = await db.getDB().select<ListOrder>('*')
        .from(tableNames.listOrder)
        .whereILike('listOrderId', `%${orderParam.slice(2)}%`)
        .first()
      if (listOrder) {
        listOrderId = listOrder.listOrderId as viem.Hex
      }
    } else {
      listOrderId = orderParam as viem.Hex
    }
  }
  return listOrderId
}

export const getImage = (parseOrder: boolean): RequestHandler => async (req, res, next) => {
  const { chainId, address: addressParam, orderParam } = req.params
  if (!+chainId) {
    return next(httpErrors.BadRequest('chainId'))
  }
  const { filename: address, exts } = splitExt(addressParam)
  if (!viem.isAddress(address)) {
    return next(httpErrors.BadRequest('address'))
  }
  const listOrderId = parseOrder ? await getListOrderId(orderParam) : null
  const { img } = await getListTokens(+chainId, address, listOrderId, exts)
  if (!img) {
    return next(httpErrors.NotFound())
  }
  sendImage(res, img)
}

export const getImageAndFallback: RequestHandler = async (req, res, next) => {
  const { chainId, address: addressParam, order: orderParam } = req.params
  if (!+chainId) {
    return next(httpErrors.BadRequest('chainId'))
  }
  const { filename: address, exts } = splitExt(addressParam)
  if (!viem.isAddress(address)) {
    return next(httpErrors.BadRequest('address'))
  }
  const listOrderId = await getListOrderId(orderParam)
  const { img } = await getListTokens(+chainId, address, listOrderId, exts)
  if (!img) {
    // console.log(path.join(req.baseUrl, '..'), path.join(req.baseUrl, '.'))
    // req.originalUrl = req.originalUrl.split('/fallback/').join('/')
    return getImage(false)(req, res, next)
    // return next(httpErrors.NotFound())
  }
  sendImage(res, img)
}

export const getImageByHash: RequestHandler = async (req, res, next) => {
  const { filename, exts } = splitExt(req.params.imageHash)
  const img = await db.getDB().select('*')
    .from(tableNames.image)
    .where('imageHash', filename)
    .whereIn('ext', exts as string[])
    .first()
  if (!img) {
    return next(httpErrors.NotFound())
  }
  sendImage(res, img)
}

export const bestGuessNetworkImageFromOnOnChainInfo: RequestHandler = async (req, res, next) => {
  const { chainId: chainIdParam } = req.params
  const { filename: chainId, exts } = splitExt(chainIdParam)
  console.log(chainIdParam, exts)
  if (!+chainId) {
    return next(httpErrors.BadRequest('chainId'))
  }
  const { img } = await getNetworkIcon(+chainId, exts)
  if (!img) {
    return next(httpErrors.NotFound())
  }
  sendImage(res, img)
}

export const sendImage = (res: Response, img: Image) => {
  res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
    .contentType(img.ext)
    .send(img.content)
}
