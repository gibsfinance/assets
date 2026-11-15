import sharp from 'sharp'
import { UNTRUSTED_INPUT } from '../../untrusted-input'
import type { OverlayOptions } from 'sharp'
import config from '../../../config'
import { type RequestHandler, type Response } from 'express'
import httpErrors from 'http-errors'
import { getDrizzle } from '../../db/drizzle'
import { asc, eq, and, ne, sql as dsql } from 'drizzle-orm'
import * as s from '../../db/schema'
import { chainIdFilterMatch } from '../../chain-id'
import { isLinkOnlyHost } from '../../link-only-hosts'
import { LICENSE_LINK_HEADER } from './attribution'
import { setImageSecurityHeaders } from './headers'
import { REMOTE_IMAGE_SHED, sharedRemoteImages } from './remote-image'
import { loadImageBytes } from '../../image-store/image-bytes'
import { unexportedBytesSql } from '../../db/image-columns'
import {
  parsePlateRequest,
  plateInnerSide,
  plateShapeMarkup,
  wrapSvgWithPlate,
  type Plate,
  type PlateRequest,
} from './plate'
import { settlePlate, UNMEASURABLE } from './resize'
import {
  SPRITE_GAP_RANGE,
  buildSpriteQuery,
  isVectorImageExtension,
  normalizeSpriteSettings,
  planSpriteLayout,
  renderSpriteStylesheet,
  spriteQueryValues,
  spriteScopeClassName,
  spriteTokenKey,
  type SpriteLayout,
  type SpriteRequest,
  type SpriteSettings,
  type SpriteStylesheetRule,
} from '@gibs/sdk/sprite-layout'
import _ from 'lodash'

/** How many image files a sprite request reads at once. */
const FILE_READ_BATCH_SIZE = 20

interface SpriteToken {
  address: string
  chainId: string
  imageHash: string
  /** Bytes the row itself carries; null once a digest names a file. See `loadImageBytes`. */
  content: Buffer | null
  contentSha256: string | null
  ext: string
  mode: string
  uri: string
}

/** One token the layout placed, with the row it came from. */
interface PlacedToken {
  placement: SpriteLayout['placements'][number]
  row: SpriteToken
}

/**
 * Manifest key of a token: the namespaced chain, a dash, then the address. The shared layout module
 * builds it, so the server and the software development kit can never disagree on a key.
 */
export const spriteKey = spriteTokenKey

/**
 * Read every sprite parameter from a request, with the same validation as the image routes.
 *
 * Sizes, columns and limits are held inside their ranges, as they always were. A gap, a plate colour, a
 * shape or a tone that is invalid is refused with a 400 that names the parameter, never silently replaced.
 *
 * @param query The request's query string.
 * @returns The request, the normalized settings, the plate to draw, and the layout version the caller pinned.
 */
export function readSpriteRequest(query: Record<string, unknown>): {
  request: SpriteRequest
  settings: SpriteSettings
  plate: PlateRequest | null
  version: string | null
} {
  const plate = parsePlateRequest(query)
  const request: SpriteRequest = {
    size: Number(query.size),
    cols: Number(query.cols),
    limit: Number(query.limit),
    chainId: query.chainId ? String(query.chainId) : null,
    content: typeof query.content === 'string' ? query.content : null,
    scale: Number(query.scale),
    gap: parseGap(query.gap),
    bg: typeof query.bg === 'string' ? query.bg : null,
    shape: typeof query.shape === 'string' ? query.shape : null,
    contrast: typeof query.contrast === 'string' ? query.contrast : null,
  }
  return {
    request,
    settings: normalizeSpriteSettings(request),
    plate,
    version: typeof query.v === 'string' ? query.v : null,
  }
}

/**
 * Read the gap parameter. Absent means no gap. Anything that is not a whole number inside the range is refused.
 *
 * @param raw The query value.
 * @returns The gap in CSS pixels, or null when none was given.
 */
function parseGap(raw: unknown): number | null {
  if (raw === undefined) return null
  const { maximum } = SPRITE_GAP_RANGE
  if (typeof raw !== 'string' || !/^\d+$/.test(raw) || Number(raw) > maximum) {
    throw httpErrors.BadRequest(`gap must be a whole number from 0 to ${maximum}`)
  }
  return Number(raw)
}

/**
 * Match condition for `?chainId=`, following the same rule as every list endpoint.
 *
 * `network.chain_id` stores CAIP-2 identifiers (`eip155-369`, `solana-501`), so a
 * bare number names no namespace and has to match on the stored id's reference —
 * `?chainId=501` must reach `solana-501`. An explicit identifier stays exact.
 */
function chainFilterCondition(chainFilter: string) {
  const match = chainIdFilterMatch(chainFilter)
  if (match.kind === 'reference') {
    return dsql`split_part(${s.network.chainId}, '-', 2) = ${match.reference}`
  }
  return eq(s.network.chainId, match.chainId)
}

/** Resolve a list to its DB listId from provider/list path params */
async function resolveListId(providerKey: string, listKey: string): Promise<string | null> {
  const drizzle = getDrizzle()
  const [row] = await drizzle
    .select({ listId: s.list.listId })
    .from(s.list)
    .innerJoin(s.provider, eq(s.provider.providerId, s.list.providerId))
    .where(and(eq(s.provider.key, providerKey), eq(s.list.key, listKey || providerKey)))
    .limit(1)
  return row?.listId ?? null
}

/**
 * The tokens of one list in the list's own order, which is the only order a sprite may use.
 *
 * The order is total: list position, then chain, then address, then the list entry's own id. Two requests
 * with the same list and parameters therefore select the same rows in the same positions, before the limit
 * is applied, so the manifest and the sheet can never disagree. Image format is not a sort key, because a
 * sprite places tokens by position, not by the picture they show.
 *
 * @param options.withBytes Whether to return the bytes a row still carries itself (a row not yet exported to the
 *   image store). Needed for rasters and for inlined vectors; a grid manifest does not read them.
 */
function queryListTokens(listId: string, { withBytes, chainId }: { withBytes: boolean; chainId: string | null }) {
  const base = getDrizzle()
    .select({
      address: s.token.providedId,
      chainId: s.network.chainId,
      imageHash: s.image.imageHash,
      ext: s.image.ext,
      // Only a row not yet exported to the image store carries bytes here; the rest are read
      // from their files, and only for the cells that need them (see `loadImageBytes`).
      content: withBytes ? unexportedBytesSql : dsql<Buffer | null>`NULL::bytea`,
      contentSha256: s.image.contentSha256,
      mode: s.image.mode,
      uri: s.image.uri,
    })
    .from(s.listToken)
    .innerJoin(s.token, eq(s.token.tokenId, s.listToken.tokenId))
    .innerJoin(s.network, eq(s.network.networkId, s.token.networkId))
    .innerJoin(s.image, eq(s.image.imageHash, s.listToken.imageHash))
    .where(and(eq(s.listToken.listId, listId), ne(s.image.imageHash, '')))
    .orderBy(
      asc(s.listToken.listTokenOrderId),
      asc(s.network.chainId),
      asc(s.token.providedId),
      asc(s.listToken.listTokenId),
    )
    .$dynamic()
  return chainId === null ? base : base.where(chainFilterCondition(chainId))
}

/**
 * Plan a list's sprite: which token goes where, for these settings. Reads metadata only, never image bytes,
 * so the layout (and its version) cannot change between two requests for the same list.
 */
async function planListSprite(
  listId: string,
  settings: SpriteSettings,
  { withBytes }: { withBytes: boolean },
): Promise<{ layout: SpriteLayout; rows: SpriteToken[] }> {
  const rows = (await queryListTokens(listId, { withBytes, chainId: settings.chainId }).limit(
    settings.limit,
  )) as unknown as SpriteToken[]
  const layout = planSpriteLayout(
    rows.map((row) => ({
      key: spriteKey({ chainId: row.chainId, address: row.address }),
      vector: isVectorImageExtension(row.ext),
    })),
    settings,
  )
  return { layout, rows }
}

/** Answer 409 when the caller pinned a layout that is no longer current. A redirect would pair one layout's data with another's sheet. */
function sendLayoutChanged(res: Response, currentVersion: string): void {
  res.status(409).set('cache-control', 'no-store').json({
    error: 'the sprite layout has changed; read the manifest again',
    version: currentVersion,
  })
}

/**
 * Settle the plate for one picture. A plate that was asked for and cannot be measured is not drawn, and is
 * reported so the answer is not kept.
 *
 * @param row The token whose picture it is.
 * @param content The picture's bytes.
 * @param request The plate asked for, or null for none.
 */
async function settleRowPlate(
  row: SpriteToken,
  content: Buffer,
  request: PlateRequest | null,
): Promise<{ plate: Plate | null; platingFailed: boolean }> {
  if (!request) return { plate: null, platingFailed: false }
  const settled = await settlePlate({ request, key: `image:${row.imageHash}`, content, ext: row.ext })
  if (settled === UNMEASURABLE) return { plate: null, platingFailed: true }
  return { plate: settled, platingFailed: false }
}

/**
 * The picture of every inlined vector a placement list names, by key. A vector with no readable bytes has no
 * picture and is left out; it never moves a raster, because it never held a cell.
 */
async function inlinedVectors(
  planned: { layout: SpriteLayout; rows: SpriteToken[] },
  plate: PlateRequest | null,
): Promise<{ pictures: Map<string, string>; platingFailed: boolean }> {
  const inline: PlacedToken[] = planned.layout.placements.flatMap((placement) =>
    placement.kind === 'inline' ? [{ placement, row: planned.rows[placement.source] }] : [],
  )
  const pictures = new Map<string, string>()
  let platingFailed = false
  for (const batch of _.chunk(inline, FILE_READ_BATCH_SIZE)) {
    const read = await Promise.all(batch.map(({ row }) => loadImageBytes(row)))
    const drawn = await Promise.all(batch.map(({ row }, index) => drawVector(row, read[index], plate)))
    batch.forEach(({ placement }, index) => {
      const picture = drawn[index]
      if (picture.platingFailed) platingFailed = true
      if (picture.bytes) pictures.set(placement.key, `data:image/svg+xml;base64,${picture.bytes.toString('base64')}`)
    })
  }
  return { pictures, platingFailed }
}

/**
 * One vector's bytes, inside its plate when one is asked for and can be drawn. Missing bytes give no picture.
 */
async function drawVector(
  row: SpriteToken,
  bytes: Buffer | null,
  plate: PlateRequest | null,
): Promise<{ bytes: Buffer | null; platingFailed: boolean }> {
  if (!bytes || bytes.length === 0) return { bytes: null, platingFailed: false }
  const settled = await settleRowPlate(row, bytes, plate)
  if (!settled.plate) return { bytes, platingFailed: settled.platingFailed }
  const plated = wrapSvgWithPlate({ content: bytes, plate: settled.plate })
  return { bytes: plated ?? bytes, platingFailed: plated === null }
}

/**
 * The original bytes of a raster cell, read from the store or fetched from its link. Null when it has none;
 * `REMOTE_IMAGE_SHED` when its download was turned away for load.
 */
async function cellSource(row: SpriteToken): Promise<Buffer | null | typeof REMOTE_IMAGE_SHED> {
  const stored = row.mode === 'link' ? null : await loadImageBytes(row)
  if (stored && stored.length > 0) return stored
  if (!row.uri) return null
  // A link-only host's terms forbid a copy and a derivative; a sprite cell is both.
  if (isLinkOnlyHost(row.uri)) return null
  const remote = await sharedRemoteImages.load({ uri: row.uri, ext: row.ext })
  if (remote === REMOTE_IMAGE_SHED) return REMOTE_IMAGE_SHED
  return remote || null
}

/**
 * A logo drawn to fit a square of `side` pixels, transparent around it. Null when sharp cannot decode the bytes,
 * so one bad file becomes an empty cell instead of rejecting the whole sheet.
 */
async function drawLogo(source: Buffer, side: number): Promise<Buffer | null> {
  try {
    return await sharp(source, UNTRUSTED_INPUT)
      .resize(side, side, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
  } catch {
    return null
  }
}

/** A cell's contribution to the sheet. */
interface DrawnCell {
  composite: OverlayOptions | null
  /** Where a plate goes under this cell, when one was drawn. */
  plated: { left: number; top: number; plate: Plate } | null
  shed: boolean
  platingFailed: boolean
}

const EMPTY_CELL: DrawnCell = { composite: null, plated: null, shed: false, platingFailed: false }

/**
 * Draw one raster cell: its logo, inset inside a plate when one is drawn for it.
 */
async function drawCell(
  placed: PlacedToken & { placement: Extract<PlacedToken['placement'], { kind: 'cell' }> },
  layout: SpriteLayout,
  plate: PlateRequest | null,
): Promise<DrawnCell> {
  const source = await cellSource(placed.row)
  if (source === REMOTE_IMAGE_SHED) return { ...EMPTY_CELL, shed: true }
  if (!source) return EMPTY_CELL
  const settled = await settleRowPlate(placed.row, source, plate)
  const logoSide = settled.plate
    ? plateInnerSide({ side: layout.cellPixels, shape: settled.plate.shape })
    : layout.cellPixels
  const logo = await drawLogo(source, logoSide)
  const left = placed.placement.column * layout.pitchPixels
  const top = placed.placement.row * layout.pitchPixels
  if (!logo) return { ...EMPTY_CELL, platingFailed: settled.platingFailed }
  const inset = Math.round((layout.cellPixels - logoSide) / 2)
  return {
    composite: { input: logo, left: left + inset, top: top + inset },
    plated: settled.plate ? { left, top, plate: settled.plate } : null,
    shed: false,
    platingFailed: settled.platingFailed,
  }
}

/**
 * The document that paints every plate of a sheet, one per plated cell, at its cell's corner.
 *
 * One layer for the whole sheet, so the plates cost one render however many cells are plated. The plate
 * markup is the single-image markup, drawn in its 100-unit square and scaled to the cell.
 *
 * @param plated The plates to paint, with their cell corners in sheet pixels.
 * @param layout The layout, which gives the sheet size and the cell size.
 * @returns The SVG document.
 */
export function plateLayerDocument(
  plated: { left: number; top: number; plate: Plate }[],
  layout: SpriteLayout,
): string {
  const width = layout.sheetWidth
  const height = layout.sheetHeight
  const scale = layout.cellPixels / 100
  const groups = plated.map(
    ({ left, top, plate }) => `<g transform="translate(${left} ${top}) scale(${scale})">${plateShapeMarkup(plate)}</g>`,
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${groups.join('')}</svg>`
}

/** The cell placements of a plan, with their rows. */
function cellsOf(planned: { layout: SpriteLayout; rows: SpriteToken[] }): (PlacedToken & {
  placement: Extract<PlacedToken['placement'], { kind: 'cell' }>
})[] {
  return planned.layout.placements.flatMap((placement) =>
    placement.kind === 'cell' ? [{ placement, row: planned.rows[placement.source] }] : [],
  )
}

/**
 * The rule a placement gives the stylesheet, or none when a vector has no picture.
 */
function stylesheetRuleOf(
  placement: SpriteLayout['placements'][number],
  pictures: Map<string, string>,
): SpriteStylesheetRule[] {
  if (placement.kind === 'cell')
    return [{ kind: 'cell', key: placement.key, column: placement.column, row: placement.row }]
  const dataAddress = pictures.get(placement.key)
  return dataAddress === undefined ? [] : [{ kind: 'inline', key: placement.key, dataAddress }]
}

/**
 * The manifest's `tokens` map for a plan: a grid position for each raster, a data address for each vector.
 */
function manifestTokens(
  layout: SpriteLayout,
  pictures: Map<string, string>,
): Record<string, [number, number] | string> {
  const tokens: Record<string, [number, number] | string> = {}
  for (const rule of layout.placements.flatMap((placement) => stylesheetRuleOf(placement, pictures))) {
    tokens[rule.key] = rule.kind === 'cell' ? [rule.column, rule.row] : rule.dataAddress
  }
  return tokens
}

/** The addresses of a list's sprite for a layout, without the instance's own host. */
function addressesFor(providerKey: string, listKey: string, settings: SpriteSettings, version: string) {
  const base = `/sprite/${encodeURIComponent(providerKey)}/${encodeURIComponent(listKey)}`
  const query = buildSpriteQuery(spriteQueryValues(settings, version))
  return { sheet: `${base}/sheet?${query}`, stylesheet: `${base}/sheet.css?${query}` }
}

// ---------------------------------------------------------------------------
// Manifest: GET /sprite/:providerKey/:listKey
// ---------------------------------------------------------------------------

/**
 * Returns JSON manifest for a list's sprite sheet.
 *
 * ?content=mixed — vectors are returned as inline data addresses; rasters are placed on the grid.
 * (default)     — every token is placed on the grid.
 * ?chainId=N    — filter to a specific chain within the list.
 * ?gap, ?bg, ?shape, ?contrast, ?scale — see the sprite documentation.
 */
export const manifest: RequestHandler = async (req, res, _next) => {
  const { providerKey, listKey } = req.params
  const listId = await resolveListId(providerKey, listKey)
  // Respond with the documented JSON Error shape — `next()` here fell through
  // to the framework's HTML 404, breaking JSON consumers.
  if (!listId) {
    res.status(404).json({ error: 'unknown provider or list' })
    return
  }

  const { settings, plate } = readSpriteRequest(req.query)
  const planned = await planListSprite(listId, settings, { withBytes: settings.content === 'mixed' })
  const vectors = await inlinedVectors(planned, plate)
  const { layout } = planned
  const addresses = addressesFor(providerKey, listKey, settings, layout.version)
  const tokens = manifestTokens(layout, vectors.pictures)

  res.set('cache-control', vectors.platingFailed ? 'no-store' : `public, max-age=${config.cacheSeconds}`)
  res.set('link', LICENSE_LINK_HEADER)
  res.json({
    spriteUrl: addresses.sheet,
    stylesheetUrl: addresses.stylesheet,
    size: settings.size,
    scale: settings.scale,
    gap: settings.gap,
    cols: settings.cols,
    rows: layout.rows,
    rasterCount: layout.placements.filter((placement) => placement.kind === 'cell').length,
    svgCount: vectors.pictures.size,
    count: Object.keys(tokens).length,
    version: layout.version,
    plate: settings.plate,
    tokens,
  })
}

// ---------------------------------------------------------------------------
// Sheet: GET /sprite/:providerKey/:listKey/sheet
// ---------------------------------------------------------------------------

export const sheet: RequestHandler = async (req, res, _next) => {
  const { providerKey, listKey } = req.params
  const listId = await resolveListId(providerKey, listKey)
  // Same JSON 404 as the manifest — see the comment there.
  if (!listId) {
    res.status(404).json({ error: 'unknown provider or list' })
    return
  }

  const { settings, plate, version } = readSpriteRequest(req.query)
  const planned = await planListSprite(listId, settings, { withBytes: true })
  const { layout } = planned
  if (version !== null && version !== layout.version) {
    sendLayoutChanged(res, layout.version)
    return
  }

  const cells = cellsOf(planned)
  if (cells.length === 0) {
    res.status(204).end()
    return
  }

  const composites: OverlayOptions[] = []
  const plated: { left: number; top: number; plate: Plate }[] = []
  let cellsShed = 0
  let platingFailed = false
  for (const batch of _.chunk(cells, FILE_READ_BATCH_SIZE)) {
    const drawn = await Promise.all(batch.map((cell) => drawCell(cell, layout, plate)))
    for (const cell of drawn) {
      if (cell.shed) cellsShed += 1
      if (cell.platingFailed) platingFailed = true
      if (cell.composite) composites.push(cell.composite)
      if (cell.plated) plated.push(cell.plated)
    }
  }
  if (plated.length > 0) {
    const plates = await sharp(Buffer.from(plateLayerDocument(plated, layout)))
      .png()
      .toBuffer()
    composites.unshift({ input: plates, left: 0, top: 0 })
  }

  const sprite = await sharp({
    create: {
      width: Math.max(layout.sheetWidth, 1),
      height: layout.sheetHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp({ quality: 85 })
    .toBuffer()

  // Grid metadata in headers (small, always fits)
  const tokenMap: Record<string, [number, number]> = {}
  for (const { placement } of cells) tokenMap[placement.key] = [placement.column, placement.row]
  const tokenJson = JSON.stringify(tokenMap)

  res.set('content-type', 'image/webp')
  setImageSecurityHeaders(res)
  res.set('link', LICENSE_LINK_HEADER)
  // A sheet with a cell that is empty only because the server was busy, or with a plate it could not draw,
  // is not the sheet this list should have, so it is not kept.
  res.set('cache-control', cellsShed > 0 || platingFailed ? 'no-store' : `public, max-age=${config.cacheSeconds}`)
  res.set('x-sprite-size', String(settings.size))
  res.set('x-sprite-scale', String(settings.scale))
  res.set('x-sprite-gap', String(settings.gap))
  res.set('x-sprite-cols', String(settings.cols))
  res.set('x-sprite-rows', String(layout.rows))
  res.set('x-sprite-count', String(cells.length))
  res.set('x-sprite-version', layout.version)
  // Token map can exceed header size limits — use the manifest endpoint instead.
  if (tokenJson.length < 4096) {
    res.set('x-sprite-tokens', tokenJson)
  }
  res.set(
    'access-control-expose-headers',
    'x-sprite-size, x-sprite-scale, x-sprite-gap, x-sprite-cols, x-sprite-rows, x-sprite-count, x-sprite-version, x-sprite-tokens',
  )
  res.send(sprite)
}

// ---------------------------------------------------------------------------
// Stylesheet: GET /sprite/:providerKey/:listKey/sheet.css
// ---------------------------------------------------------------------------

/**
 * The list's stylesheet: one scope class for the sheet, and a rule per token that gives its cell or its
 * vector picture. Its rules name the sheet at the same layout version, so the pair is always consistent.
 */
export const stylesheet: RequestHandler = async (req, res, _next) => {
  const { providerKey, listKey } = req.params
  const listId = await resolveListId(providerKey, listKey)
  if (!listId) {
    res.status(404).json({ error: 'unknown provider or list' })
    return
  }

  const { request, settings, plate, version } = readSpriteRequest(req.query)
  const planned = await planListSprite(listId, settings, { withBytes: settings.content === 'mixed' })
  const { layout } = planned
  if (version !== null && version !== layout.version) {
    sendLayoutChanged(res, layout.version)
    return
  }

  const vectors = await inlinedVectors(planned, plate)
  const rules = layout.placements.flatMap((placement) => stylesheetRuleOf(placement, vectors.pictures))
  const addresses = addressesFor(providerKey, listKey, settings, layout.version)

  res.set('content-type', 'text/css; charset=utf-8')
  // A stylesheet is not an image, so the image policy does not apply; nosniff still stops a browser guessing a type.
  res.set('x-content-type-options', 'nosniff')
  res.set('link', LICENSE_LINK_HEADER)
  res.set('cache-control', vectors.platingFailed ? 'no-store' : `public, max-age=${config.cacheSeconds}`)
  res.send(
    renderSpriteStylesheet({
      scope: spriteScopeClassName(providerKey, listKey, request),
      sheetAddress: addresses.sheet,
      settings,
      rules,
    }),
  )
}
