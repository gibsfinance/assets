/**
 * @module image/handlers
 * Express handlers for token image serving: lookup, format validation, resize, and fallback.
 *
 * Image lookup flow: getListImage → getListTokens (DB query via applyOrder or direct drizzle)
 * → validateOutputFormat → sendImage (redirect/serve decision via classifyImageServe).
 *
 * Query params: `?as=webp` converts output format, `?only=vector` filters source type,
 * `?mode=link` forces redirect to source URI. Path extension (`.webp`) is equivalent to `?as=`.
 *
 * `getImageByHash` is content-addressed — the hash in the URL is the hash of the bytes it
 * serves — so both it and any resized variant of it carry a year-long, immutable cache-control
 * (see `CachePolicy` in `./resize`) instead of the configured, shorter, default. The best-guess
 * network route also sets `RESOLVED_CHAIN_HEADER` on success, naming the chain identifier a bare
 * numeric request actually resolved to.
 */
import * as viem from 'viem'
import httpErrors, { HttpError } from 'http-errors'
import * as path from 'path'
import { imageMode } from '../../db/tables'
import type { ChainId } from '@gibs/utils'
import * as utils from '../../utils'
import * as db from '../../db'
import type { Image, ListOrder, ListOrderItem, ListToken, List, Token } from '../../db/schema-types'
import { RequestHandler, Response } from 'express'
import _ from 'lodash'
import { ParsedQs } from 'qs'
import { getDefaultListOrderId } from '../../db/sync-order'
import { ImageModeParam } from '../../types'
import { maybeResize, parseResizeParams, cacheControlFor, stripRootSvgDimensions, type CachePolicy } from './resize'
import { attributionHeaders } from './attribution'
import { getDrizzle } from '../../db/drizzle'
import { eq, and, inArray, type SQL } from 'drizzle-orm'
import * as s from '../../db/schema'
import { toCAIP2, namespaceOf, isBareNumeric, resolveChainIdAgainstStored } from '../../chain-id'
import { RESOLVED_CHAIN_HEADER } from './headers'

export { RESOLVED_CHAIN_HEADER }

/** Chain-id namespaces whose token addresses are Ethereum-Virtual-Machine hex. */
const EVM_NAMESPACES = new Set(['eip155', 'asset'])

/** A non-Ethereum-Virtual-Machine token identifier: bounded, rejects obvious garbage. */
const NON_EVM_TOKEN_ID_REGEX = /^[A-Za-z0-9]{2,128}$/

/**
 * Validate a token address for its chain. Ethereum-Virtual-Machine chains
 * (eip155/asset) require a hex address; every other namespace (Solana base58,
 * Tron base58, future Sui object ids, ...) accepts a bounded token identifier
 * and lets the database lookup decide. The bound only rejects obvious garbage
 * so an unservable request still returns 400 instead of an empty 200. Keyed on
 * the eip155/asset namespaces explicitly (not namespaceToNetworkType, which
 * defaults unknown namespaces to evm) so it stays correct for future non-EVM
 * namespaces.
 *
 * A BARE number names no namespace, so neither shape can be ruled out: `/image/501/`
 * is Solana (solana-501) and wants base58, while `/image/1/` is Ethereum and wants
 * hex. Assuming eip155 rejected every base58 address reachable through a bare id,
 * and `/stats` hands out exactly those bare ids. Both shapes are therefore accepted
 * when the namespace is unstated, which trades a 400 for a 404 on a wrong-shaped
 * address — the lookup still refuses to serve it, and "no such token" is the more
 * accurate answer than "malformed request". Resolving the namespace properly would
 * mean a database round trip on every image request; this stays free.
 */
export const isValidTokenAddress = (chainId: ChainId, address: string): boolean => {
  const raw = String(chainId)
  if (isBareNumeric(raw)) return viem.isAddress(address) || NON_EVM_TOKEN_ID_REGEX.test(address)
  const namespace = namespaceOf(toCAIP2(raw))
  if (EVM_NAMESPACES.has(namespace)) return viem.isAddress(address)
  return NON_EVM_TOKEN_ID_REGEX.test(address)
}

export const getListTokens = async ({
  chainId,
  address,
  listOrderId,
  exts,
  providerKey,
  listKey,
}: {
  chainId: ChainId
  address: string
  listOrderId?: viem.Hex | null
  exts?: string[]
  providerKey?: string[]
  listKey?: string[]
}) => {
  const networkId = utils.chainIdToNetworkId(chainId)
  const drizzle = getDrizzle()

  // Build WHERE conditions
  const conditions: SQL[] = [eq(s.token.networkId, networkId), eq(s.token.providedId, address)]
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
    const rows = await db.applyOrder(effectiveOrderId, whereClause, 'provider', undefined, { includeContent: true })
    return {
      filter: { networkId, providedId: address },
      img: rows[0] as
        | (Record<string, unknown> & Image & Token & ListOrder & ListOrderItem & ListToken & List)
        | undefined,
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

  // Flatten the joined row into a single object. Both `provider` and `list` carry
  // `key` and `name` columns, so spreading `list` after `provider` overwrites the
  // provider's key and name with the list's — `img.key` on this path names the
  // LIST, not the provider. Read the provider key out first, under its own name,
  // before the spread destroys it, the way applyOrder's SQL already aliases it as
  // "providerKey". Never read `img.key` for provider identity on this path.
  const img = row
    ? { ...row.provider, ...row.list, ...row.list_token, ...row.token, ...row.image, providerKey: row.provider?.key }
    : undefined

  return {
    filter: { networkId, providedId: address },
    img: img as (Image & Token & ListOrder & ListOrderItem & ListToken & List & { providerKey?: string }) | undefined,
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
    // The network row records which collector supplied its icon as
    // `imageProviderKey`, but everything downstream reads `providerKey`. Without
    // this the provider never reached attribution for a network icon at all, and
    // the licence came out right only because the old local path happened to name
    // its source - which stopped being true the moment that path became a public
    // address. The token path above had the same gap and closed it the same way.
    img: row ? ({ ...row.image, ...row.network, providerKey: row.network?.imageProviderKey } as any) : undefined,
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

/** Maps user-facing format names to concrete file extensions */
export const formatToExts = new Map<string, string[]>([
  ['vector', ['.svg', '.svg+xml', '.xml']],
  ['svg', ['.svg', '.svg+xml']],
  ['webp', ['.webp']],
  ['png', ['.png']],
  ['jpg', ['.jpg', '.jpeg']],
  ['jpeg', ['.jpg', '.jpeg']],
  ['gif', ['.gif']],
  ['raster', ['.png', '.jpg', '.jpeg', '.webp', '.gif']],
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

/** Parse ?only= query param into source extension filter */
export const parseTypeFilter = (query: string | ParsedQs | (string | ParsedQs)[] | undefined): string[] | undefined => {
  if (!query) return undefined
  const raw = _.isString(query) ? query.toLowerCase() : ''
  if (!raw) return undefined
  const exts = formatToExts.get(raw)
  return exts ?? undefined
}

export const CONVERTIBLE_RASTER = new Set(['.png', '.webp', '.jpg', '.jpeg', '.gif', '.avif'])
export const SVG_EXTS = new Set(['.svg', '.svg+xml'])

/**
 * Validate whether the requested output format is compatible with the source image.
 * Returns null if valid, or an error string describing the incompatibility.
 */
export const validateOutputFormat = (sourceExt: string, outputExt: string): string | null => {
  const isSvgSource = SVG_EXTS.has(sourceExt)
  const wantsSvg = outputExt === '.svg' || outputExt === '.svg+xml'
  if (wantsSvg && !isSvgSource) {
    return 'no SVG available for this token'
  }
  const wantsRaster = CONVERTIBLE_RASTER.has(outputExt)
  if (!wantsRaster && !wantsSvg) {
    return `unsupported output format ${outputExt}`
  }
  return null
}

const getListImage =
  (parseOrder: boolean) =>
  async ({
    chainId,
    address: addressParam,
    order: orderParam,
    typeFilter,
    providerKey,
    listKey,
  }: {
    chainId: ChainId
    address: string
    order?: string
    typeFilter?: string[]
    providerKey?: string[]
    listKey?: string[]
  }): Promise<{ img: Image & Record<string, unknown>; outputExt: string | null }> => {
    if (!chainId) {
      throw httpErrors.BadRequest('chainId')
    }
    const { filename: address, ext: requestedExt } = splitExt(addressParam)
    if (!isValidTokenAddress(chainId, address)) {
      throw httpErrors.BadRequest('address')
    }
    const outputExt = requestedExt ?? null
    const listOrderId = parseOrder && orderParam ? await db.getListOrderId(orderParam as string) : null
    const { img } = await getListTokens({
      chainId,
      address,
      listOrderId,
      exts: typeFilter,
      providerKey,
      listKey,
    })
    if (!img) {
      throw httpErrors.NotFound('list image missing')
    }
    // Validate format compatibility
    if (outputExt) {
      const formatError = validateOutputFormat(img.ext, outputExt)
      if (formatError) {
        const status = formatError.startsWith('unsupported') ? 406 : 404
        throw status === 406 ? httpErrors.NotAcceptable(formatError) : httpErrors.NotFound(formatError)
      }
    }
    return { img, outputExt }
  }

/** Convert Express query param to a flat string array, handling string, array, and object shapes */
export const queryStringToList = (query: string | ParsedQs | (string | ParsedQs)[] | undefined): string[] => {
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
  async (req, res, _next) => {
    const { img, outputExt } = await getListImage(parseOrder)({
      chainId: req.params.chainId,
      address: req.params.address,
      order: req.params.order,
      typeFilter: parseTypeFilter(req.query.only),
      providerKey: queryStringToList(req.query.providerKey),
      listKey: queryStringToList(req.query.listKey),
    })
    // Path extension (.webp, .png) = output format conversion. Parsed once and
    // passed explicitly — Express 5 re-parses req.query on every access, so a
    // mutation written into it never reaches maybeResize.
    const params = parseResizeParams({ query: req.query, pathExt: outputExt })
    if (await maybeResize({ res, img, params })) return
    sendImage(res, img, resolveImageMode(req.query.mode as ImageModeParam | null | undefined))
  }

export const getImageAndFallback: RequestHandler = async (req, res, next) => {
  const providerKey = queryStringToList(req.query.providerKey)
  const listKey = queryStringToList(req.query.listKey)
  const typeFilter = parseTypeFilter(req.query.only)
  let result = await getListImage(true)({
    chainId: req.params.chainId,
    address: req.params.address,
    order: req.params.order,
    typeFilter,
    providerKey,
    listKey,
  }).catch(ignoreNotFound)
  if (!result) {
    result = await getListImage(false)({
      chainId: req.params.chainId,
      address: req.params.address,
      typeFilter,
      providerKey,
      listKey,
    }).catch(ignoreNotFound)
  }
  if (!result) return next(httpErrors.NotFound('image not found'))
  const { img, outputExt } = result
  // Same explicit-options path as getImage — this handler used to write the
  // wrong query key (`format` instead of `as`), so the conversion never fired.
  const params = parseResizeParams({ query: req.query, pathExt: outputExt })
  if (await maybeResize({ res, img, params })) return
  sendImage(res, img, resolveImageMode(req.query.mode as ImageModeParam | null | undefined))
}

export const getImageByHash: RequestHandler = async (req, res, next) => {
  // The path extension here is a SOURCE filter (hash.svg → serve only if the
  // stored image is an SVG), not an output conversion.
  const { filename, exts } = splitExt(req.params.imageHash)
  const conditions: SQL[] = [eq(s.image.imageHash, filename)]
  // Bare hashes have no extension — guard here at the funnel: inArray with an
  // undefined list built invalid SQL and turned the documented form into a 500.
  if (exts?.length) {
    conditions.push(inArray(s.image.ext, exts))
  }
  const drizzle = getDrizzle()
  const [img] = await drizzle
    .select()
    .from(s.image)
    .where(and(...conditions))
    .limit(1)
  if (!img) {
    return next(httpErrors.NotFound('image not found'))
  }
  const image = img as Image
  const params = parseResizeParams({ query: req.query })
  // Content-addressed: the hash in the URL is the hash of these exact bytes, so
  // they can never change at this address. A year-long, immutable cache is
  // honest here in a way it would not be for a token or chain image, which can
  // get new content at the same address later. Both the un-resized original
  // below and any resized/transcoded variant maybeResize serves carry the same
  // policy — a caller who asks for a resized hash-addressed image gets the same
  // permanent-cache guarantee as one who asks for the original.
  if (await maybeResize({ res, img: image, params, cachePolicy: 'content-addressed' })) return
  sendImage(res, image, resolveImageMode(req.query.mode as ImageModeParam | null | undefined), 'content-addressed')
}

/**
 * Resolve a network-icon chain id the way the token-list endpoints do. A bare number
 * names no namespace, and toCAIP2 assumes eip155 — so `/image/354` asked for eip155-354,
 * matched no row, and answered 404, while `/networks` kept advertising polkadot-354's
 * icon under the very same bare 354. Matching the number against the networks actually
 * stored lets the two paths name the same network. A number genuinely shared by several
 * populated namespaces is reported as a 400 rather than resolved to one arbitrarily. An
 * explicitly namespaced request is already an assertion about namespace, so it passes
 * through untouched and pays no lookup. This mirrors tokensByChain and the provider-list
 * handler; see resolveChainIdAgainstStored.
 */
const resolveNetworkChainId = async (chainId: string): Promise<string> => {
  if (!isBareNumeric(chainId)) return chainId
  const storedCandidates = await db.getChainIdsByReference(chainId)
  const resolution = resolveChainIdAgainstStored(chainId, storedCandidates)
  if (resolution.status === 'ambiguous') {
    throw httpErrors.BadRequest(
      `ambiguous chainId "${chainId}" — it exists in several namespaces (${resolution.candidates.join(', ')}); request one explicitly`,
    )
  }
  return resolution.chainId
}

const bestGuessNeworkImage = async (
  chainIdParam: string,
): Promise<{ img: Image & Record<string, unknown>; resolvedChainId: string }> => {
  const { filename: chainId, exts } = splitExt(chainIdParam)
  const resolvedChainId = await resolveNetworkChainId(chainId)
  const { img } = await getNetworkIcon(resolvedChainId, exts)
  if (!img) {
    throw httpErrors.NotFound('best guess network image not found')
  }
  return { img, resolvedChainId }
}

export const bestGuessNetworkImageFromOnOnChainInfo: RequestHandler = async (req, res, _next) => {
  const { img, resolvedChainId } = await bestGuessNeworkImage(req.params.chainId)
  // A caller who gets a 200 cannot otherwise tell an exact match from an
  // approximation — worse than an outright 404 for a page identifying a chain
  // to a user. Set before serving, so it rides on every success shape below
  // (redirect, resized variant, or the original).
  res.set(RESOLVED_CHAIN_HEADER, resolvedChainId)
  // Note: a path extension on the network route is a source filter (handled in
  // bestGuessNeworkImage), not an output conversion — so no pathExt here.
  const params = parseResizeParams({ query: req.query })
  if (await maybeResize({ res, img, params })) return
  sendImage(res, img, resolveImageMode(req.query.mode as ImageModeParam | null | undefined))
}

/** Swallow 404 errors (return null), re-throw anything else */
export const ignoreNotFound = (err: HttpError) => {
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
  { i: string | string[]; mode: ImageModeParam; as?: string; only?: string } & KeyFilterQuery
> = async (req, res, next) => {
  const { i } = req.query
  let images: string[] = []
  if (Array.isArray(i)) images = i.map((i) => i.toString())
  else if (i) {
    images = [i.toString()]
  }
  const params = parseResizeParams({ query: req.query })
  for (const i of images) {
    if (!_.isString(i)) {
      return next(httpErrors.NotAcceptable('invalid i'))
    }
    const [chainId, address, order] = i.split('/')
    if (!address) {
      const result = await bestGuessNeworkImage(chainId).catch(ignoreNotFound)
      if (!result) continue
      if (await maybeResize({ res, img: result.img, params })) return
      return sendImage(res, result.img, resolveImageMode(req.query.mode))
    }
    if (order && order.length !== 64 /* check if hex */) {
      return next(httpErrors.NotAcceptable('invalid order'))
    }
    const providerKey = queryStringToList(req.query.providerKey)
    const listKey = queryStringToList(req.query.listKey)
    const typeFilter = parseTypeFilter(req.query.only)
    // Pass the raw segment like the path handlers do — chainIdToNetworkId owns
    // the conversion, so prefixed (eip155-369) and bare (369) forms both work.
    // Number() here turned prefixed ids into NaN and 400'd the request.
    let result = await getListImage(true)({
      chainId,
      address,
      order,
      typeFilter,
      providerKey,
      listKey,
    }).catch(ignoreNotFound)
    if (!result) {
      result = await getListImage(false)({
        chainId,
        address,
        typeFilter,
        providerKey,
        listKey,
      }).catch(ignoreNotFound)
    }
    if (result) {
      if (await maybeResize({ res, img: result.img, params })) return
      return sendImage(res, result.img, resolveImageMode(req.query.mode))
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

export const MIN_SERVABLE_RASTER_SIZE = 200

export type ImageServeDecision = 'redirect' | 'serve' | 'unavailable'

/** Decide how to serve an image: redirect to source, serve content, or 404 */
export const classifyImageServe = (
  img: { ext: string; content: Buffer | null; uri: string | null },
  mode: string,
): ImageServeDecision => {
  const isSvg = img.ext === '.svg' || img.ext === '.svg+xml'
  const hasContent = img.content && img.content.length > 0
  const isTooSmall = hasContent && !isSvg && img.content!.length < MIN_SERVABLE_RASTER_SIZE
  const hasRedirectUri = img.uri && img.uri.startsWith('http')

  if ((mode === imageMode.LINK || !hasContent || isTooSmall) && hasRedirectUri) {
    return 'redirect'
  }
  if (!hasContent || isTooSmall) {
    return 'unavailable'
  }
  return 'serve'
}

export const sendImage = (
  res: Response,
  img: Image & { providerKey?: string },
  mode: ImageModeParam,
  cachePolicy: CachePolicy = 'mutable',
) => {
  const decision = classifyImageServe(img, mode)
  // attributionHeaders() normalizes img.uri itself — an absolute submodule
  // filesystem path, an http(s)/ipfs uri, or a data: uri all resolve to the
  // right x-source-uri/x-uri (or no uri header at all) from the raw value.
  const headers = attributionHeaders({ uri: img.uri, providerKey: img.providerKey })
  if (decision === 'redirect') {
    // A caller sent away to fetch from the source directly still needs to know
    // its licence and provenance — arguably more than one served our own bytes,
    // since they are about to leave for a third-party host entirely. Without
    // this, every link-only image (every DeBank address, by design) would
    // redirect with none of the headers /terms promises on every response.
    for (const [name, value] of Object.entries(headers)) {
      res.set(name, value)
    }
    return res.redirect(img.uri)
  }
  if (decision === 'unavailable') {
    return res.status(404).json({ error: 'image content unavailable' })
  }

  let r = res.set('cache-control', cacheControlFor(cachePolicy))
  r = r.set('x-resize', 'original')
  for (const [name, value] of Object.entries(headers)) {
    r = r.set(name, value)
  }
  // A root <svg> with a viewBox scales cleanly from that alone, so its fixed
  // width and height only force cascading-style-sheet consumers to override
  // or strip them. Only the root element is ever rewritten — see
  // stripRootSvgDimensions.
  //
  // The content-addressed route is deliberately excluded. Its whole contract is
  // that the hash in the path is the hash of the bytes it returns, which is also
  // what makes a year-long immutable lifetime safe to promise. Rewriting the
  // markup there would break that digest for every caller who verifies it, and
  // the year-long cache would carry the broken promise well past any correction.
  // Presentation is worth less than an integrity guarantee, so the hash route
  // serves exactly what was stored.
  const rewritable = SVG_EXTS.has(img.ext) && cachePolicy !== 'content-addressed'
  const content = rewritable ? stripRootSvgDimensions(img.content) : img.content
  r.contentType(img.ext).send(content)
}
