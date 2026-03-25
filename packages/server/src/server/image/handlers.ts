import * as viem from 'viem'
import httpErrors, { HttpError } from 'http-errors'
import * as path from 'path'
import { imageMode } from '../../db/tables'
import type { ChainId } from '@gibs/utils'
import * as utils from '../../utils'
import * as db from '../../db'
import config from '../../../config'
import { Image, ListOrder, ListOrderItem, ListToken, List, Token } from 'knex/types/tables'
import { RequestHandler, Response } from 'express'
import _ from 'lodash'
import { ParsedQs } from 'qs'
import { submodules } from '../../paths'
import { getDefaultListOrderId } from '../../db/sync-order'
import { ImageModeParam } from '../../types'
import { maybeResize } from './resize'
import { getDrizzle } from '../../db/drizzle'
import { eq, and, inArray, sql as dsql, type SQL } from 'drizzle-orm'
import * as s from '../../db/schema'

export const getListTokens = async ({
  chainId,
  address,
  listOrderId,
  exts,
  providerKey,
  listKey,
}: {
  chainId: ChainId
  address: viem.Hex
  listOrderId?: viem.Hex | null
  exts?: string[]
  providerKey?: string[]
  listKey?: string[]
}) => {
  const networkId = utils.chainIdToNetworkId(chainId)
  const drizzle = getDrizzle()

  // Build WHERE conditions
  const conditions: SQL[] = [
    eq(s.token.networkId, networkId),
    eq(s.token.providedId, address),
  ]
  if (exts?.length) {
    conditions.push(inArray(s.image.ext, exts))
  }
  if (providerKey?.length) {
    conditions.push(inArray(s.provider.key, providerKey))
  }
  if (listKey?.length) {
    conditions.push(inArray(s.list.key, listKey))
  }
  const whereClause = and(...conditions)!

  const effectiveOrderId = listOrderId ?? getDefaultListOrderId()
  if (effectiveOrderId) {
    const rows = await db.applyOrder(effectiveOrderId, whereClause, 'provider')
    return {
      filter: { networkId, providedId: address },
      img: rows[0] as (Record<string, unknown> & Image & Token & ListOrder & ListOrderItem & ListToken & List) | undefined,
    }
  }

  // No ordering — simple query
  const [row] = await drizzle
    .select()
    .from(s.provider)
    .rightJoin(s.list, eq(s.list.providerId, s.provider.providerId))
    .rightJoin(s.listToken, eq(s.listToken.listId, s.list.listId))
    .rightJoin(s.token, eq(s.token.tokenId, s.listToken.tokenId))
    .rightJoin(s.image, eq(s.image.imageHash, s.listToken.imageHash))
    .where(whereClause)
    .limit(1)

  // Flatten the joined row into a single object
  const img = row
    ? { ...row.provider, ...row.list, ...row.list_token, ...row.token, ...row.image }
    : undefined

  return {
    filter: { networkId, providedId: address },
    img: img as (Image & Token & ListOrder & ListOrderItem & ListToken & List) | undefined,
  }
}

export const getNetworkIcon = async (chainId: ChainId, exts?: string[]) => {
  const networkId = utils.chainIdToNetworkId(chainId)
  const drizzle = getDrizzle()

  const conditions: SQL[] = [eq(s.network.networkId, networkId)]
  if (exts?.length) {
    conditions.push(inArray(s.image.ext, exts))
  }

  const [row] = await drizzle
    .select()
    .from(s.image)
    .leftJoin(s.network, eq(s.network.imageHash, s.image.imageHash))
    .where(and(...conditions))
    .limit(1)

  return {
    filter: { networkId },
    img: row ? { ...row.image, ...row.network } as any : undefined,
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
    providerKey?: string[]
    listKey?: string[]
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
  return query
    .toString()
    .split(',')
    .filter((v) => v.trim())
}

export const getImage =
  (parseOrder: boolean): RequestHandler =>
  async (req, res, next) => {
    const img = await getListImage(parseOrder)({
      chainId: Number(req.params.chainId),
      address: req.params.address as viem.Hex,
      order: req.params.order,
      providerKey: queryStringToList(req.query.providerKey),
      listKey: queryStringToList(req.query.listKey),
    })
    if (await maybeResize(req, res, img)) return
    sendImage(res, img, resolveImageMode(req.query.mode as ImageModeParam | null | undefined))
  }

export const getImageAndFallback: RequestHandler = async (req, res, next) => {
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
  if (await maybeResize(req, res, img)) return
  sendImage(res, img, resolveImageMode(req.query.mode as ImageModeParam | null | undefined))
}

export const getImageByHash: RequestHandler = async (req, res, next) => {
  const { filename, exts } = splitExt(req.params.imageHash)
  const drizzle = getDrizzle()
  const [img] = await drizzle
    .select()
    .from(s.image)
    .where(and(eq(s.image.imageHash, filename), inArray(s.image.ext, exts as string[])))
    .limit(1)
  if (!img) {
    return next(httpErrors.NotFound('image not found'))
  }
  if (await maybeResize(req, res, img as any)) return
  sendImage(res, img as any, resolveImageMode(req.query.mode as ImageModeParam | null | undefined))
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

export const bestGuessNetworkImageFromOnOnChainInfo: RequestHandler = async (req, res, next) => {
  const img = await bestGuessNeworkImage(req.params.chainId)
  if (await maybeResize(req, res, img)) return
  sendImage(res, img, resolveImageMode(req.query.mode as ImageModeParam | null | undefined))
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

export const tryMultiple: RequestHandler<
  any,
  any,
  any,
  { i: string | string[]; mode: ImageModeParam } & KeyFilterQuery
> = async (req, res, next) => {
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
      if (await maybeResize(req, res, img)) return
      return sendImage(res, img, resolveImageMode(req.query.mode))
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
      if (await maybeResize(req, res, img)) return
      return sendImage(res, img, resolveImageMode(req.query.mode))
    }
  }
  return next(httpErrors.NotFound('image not found from list'))
}

export const resolveImageMode = (mode: ImageModeParam | null | undefined): ImageModeParam => {
  if (!mode) {
    return imageMode.SAVE
  }
  if (mode === imageMode.LINK) {
    return imageMode.LINK
  }
  return imageMode.SAVE
}

export const sendImage = (res: Response, img: Image, mode: ImageModeParam) => {
  const hasContent = img.content && img.content.length > 0
  const hasRedirectUri = img.uri && img.uri.startsWith('http')

  // Redirect when explicitly LINK mode, or when content is empty but we have a URI
  if ((mode === imageMode.LINK || !hasContent) && hasRedirectUri) {
    return res.redirect(img.uri)
  }

  // No content and no valid redirect — nothing to serve
  if (!hasContent) {
    return res.status(404).json({ error: 'image content unavailable' })
  }

  let r = res.set('cache-control', `public, max-age=${config.cacheSeconds}`)
  r = r.set('x-resize', 'original')
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
