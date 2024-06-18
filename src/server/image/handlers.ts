import * as viem from 'viem'
import httpErrors from 'http-errors'
import * as path from 'path'
import { tableNames } from "@/db/tables"
import { ChainId } from "@/types"
import * as utils from '@/utils'
import * as db from '@/db'
import config from 'config'
import { Image, ListOrder, ListOrderItem, ListToken, List, Token } from 'knex/types/tables'
import { RequestHandler, Response } from 'express'

export const getListTokens = async (
  chainId: ChainId, address: viem.Hex,
  listOrderId?: viem.Hex | null, exts?: string[],
) => {
  const filter = {
    [`${tableNames.listToken}.networkId`]: utils.chainIdToNetworkId(chainId),
    [`${tableNames.listToken}.providedId`]: viem.getAddress(address),
  }
  let q = db.getDB().select('*')
    .from(tableNames.listToken)
    .join(`${config.database.schema}.${tableNames.image}`, {
      [`${tableNames.image}.imageHash`]: `${tableNames.listToken}.imageHash`,
    })
    .where(filter)
  if (exts?.length) {
    q = q.whereIn('ext', exts)
  }
  if (listOrderId) {
    q = db.applyOrder(q, listOrderId)
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

export const getImage = (parseOrder: boolean): RequestHandler => async (req, res, next) => {
  const { chainId, address: addressParam, orderParam } = req.params
  if (!+chainId) {
    return next(httpErrors.BadRequest('chainId'))
  }
  const { filename: address, exts } = splitExt(addressParam)
  if (!viem.isAddress(address)) {
    return next(httpErrors.BadRequest('address'))
  }
  const listOrderId = parseOrder ? await db.getListOrderId(orderParam) : null
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
  const listOrderId = await db.getListOrderId(orderParam)
  const { img } = await getListTokens(+chainId, address, listOrderId, exts)
  if (!img) {
    return getImage(false)(req, res, next)
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
