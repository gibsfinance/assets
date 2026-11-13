/**
 * @module image/plate
 * A "plate" is a solid shape painted behind a logo, so a dark logo stays visible on a dark page
 * (or a light one on a light page).
 *
 * Three query parameters ask for one, on every route that serves an image:
 * - `bg=<hex>`: the plate colour, three, six or eight hex digits without `#` (eight carry alpha).
 * - `shape=circle|rounded|square`: the outline, `circle` by default. On its own it does nothing:
 *   a plate needs `bg` or `contrast` to exist, so a lone `shape` is checked and then ignored.
 * - `contrast=dark|light`: "my page is dark" or "my page is light". The server measures how bright
 *   the logo really is and adds a plate in the opposite tone only when the logo would be hard to
 *   see. With `bg` as well, `bg` is the plate colour and `contrast` only decides whether to add it.
 *
 * This module holds the parts that need no image source: parsing, the contrast arithmetic, the
 * scalable-vector wrapper and the pixel renderer. `resize.ts` opens the sources and calls in.
 */
import sharp from 'sharp'
import type { FormatEnum, Sharp } from 'sharp'
import httpErrors from 'http-errors'

/** The outlines a plate can have. */
export const PLATE_SHAPES = ['circle', 'rounded', 'square'] as const
export type PlateShape = (typeof PLATE_SHAPES)[number]

/** The page tone a caller names with `contrast=`. */
export const PLATE_CONTRASTS = ['dark', 'light'] as const
export type PlateContrast = (typeof PLATE_CONTRASTS)[number]

/** The outline used when `shape` is not given. */
export const DEFAULT_PLATE_SHAPE: PlateShape = 'circle'

/** A colour with each channel 0-255 and alpha 0-1. */
export interface Rgba {
  red: number
  green: number
  blue: number
  alpha: number
}

/** What the query asked for, after validation. */
export interface PlateRequest {
  /** The `bg` colour, or null when the plate colour is left to `contrast`. */
  colour: Rgba | null
  shape: PlateShape
  /** The `contrast` page tone, or null when the plate is always painted. */
  contrast: PlateContrast | null
}

/** A plate that will be drawn. */
export interface Plate {
  colour: Rgba
  shape: PlateShape
}

/**
 * The contrast ratio a logo pixel needs against the page to count as visible. 3:1 is the Web Content
 * Accessibility Guidelines minimum for graphical objects.
 */
export const PLATE_CONTRAST_THRESHOLD = 3

/**
 * Relative luminance of a representative page for each tone. Dark is `#0d1117`, the colour many
 * dark themes use; light is white.
 */
export const PAGE_LUMINANCE: Record<PlateContrast, number> = { dark: 0.0052, light: 1 }

/**
 * The least share of a logo's visible pixels that must reach `PLATE_CONTRAST_THRESHOLD` against the
 * page, below which the logo gets a plate. A share, not an average, because many logos mix light and
 * dark parts: the Ethereum logo's blue disc stands out on white even though its white glyph does not,
 * and an average would hide that. Measured on the real files staging serves (visible pixels at 3:1 or
 * better): Cronos 0.00 on a dark page and 1.00 on a light one; Ethereum 1.00 on a dark page and 0.78 on
 * a light one. 0.25 sits well between the faint logo and the weakest logo that should be left alone.
 */
export const PLATE_VISIBLE_SHARE_THRESHOLD = 0.25

/** The plate colour used when `contrast` decides the colour: the opposite tone to the page. */
export const CONTRAST_PLATE_COLOUR: Record<PlateContrast, Rgba> = {
  dark: { red: 255, green: 255, blue: 255, alpha: 1 },
  light: { red: 17, green: 24, blue: 39, alpha: 1 },
}

/**
 * Space left between the plate's edge and the logo, as a share of the plate's side, on each side.
 * A circle needs the most: the corners of the logo's square box must stay inside the curve,
 * which needs at least 0.146.
 */
export const PLATE_PADDING_RATIO: Record<PlateShape, number> = { circle: 0.15, rounded: 0.1, square: 0.08 }

/** Corner radius of the `rounded` plate, in the 100-unit square the plate is drawn in. */
const ROUNDED_CORNER_RADIUS = 22

/** Side, in pixels, of the picture  on. */
export const VISIBILITY_SAMPLE_SIDE = 64

/** Side, in pixels, of a plated vector image drawn to a raster when no size was asked for. */
export const PLATE_DEFAULT_VECTOR_SIDE = 256

/** Most measured logos kept in memory. */
export const VISIBILITY_CACHE_LIMIT = 5000

const HEX_COLOUR = /^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * Read a colour written as 3, 6 or 8 hex digits without `#`. Three digits repeat each digit
 * (`f80` is `ff8800`); eight carry alpha last. Null when the text is anything else.
 */
export function parseHexColour(value: string): Rgba | null {
  if (!HEX_COLOUR.test(value)) return null
  const full =
    value.length === 3
      ? value
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : value
  const channel = (index: number) => parseInt(full.slice(index, index + 2), 16)
  const alpha = full.length === 8 ? channel(6) / 255 : 1
  return { red: channel(0), green: channel(2), blue: channel(4), alpha }
}

/** Read one query value that must be a single string, or fail with a 400 that names the parameter. */
function readChoice<Choice extends string>({
  query,
  name,
  choices,
}: {
  query: Record<string, unknown>
  name: string
  choices: readonly Choice[]
}): Choice | null {
  const raw = query[name]
  if (raw === undefined) return null
  const value = typeof raw === 'string' ? raw.toLowerCase() : null
  const match = choices.find((choice) => choice === value)
  if (match) return match
  throw httpErrors.BadRequest(`${name} must be one of: ${choices.join(', ')}`)
}

/**
 * Parse `bg`, `shape` and `contrast` from a query. Null when neither `bg` nor `contrast` is given,
 * since only they create a plate. Any value that is present but invalid, including `shape` on its
 * own, throws a 400 so a typo never silently serves an unplated image.
 */
export function parsePlateRequest(query: Record<string, unknown>): PlateRequest | null {
  const shape = readChoice({ query, name: 'shape', choices: PLATE_SHAPES })
  const contrast = readChoice({ query, name: 'contrast', choices: PLATE_CONTRASTS })
  const rawColour = query.bg
  if (rawColour === undefined && !contrast) return null
  if (rawColour === undefined) return { colour: null, shape: shape ?? DEFAULT_PLATE_SHAPE, contrast }
  const colour = typeof rawColour === 'string' ? parseHexColour(rawColour) : null
  if (!colour) throw httpErrors.BadRequest('bg must be 3, 6 or 8 hex digits without #, for example 1a2b3c')
  return { colour, shape: shape ?? DEFAULT_PLATE_SHAPE, contrast }
}

/** Turn an 8-bit sRGB channel into its linear-light value. */
function linearChannel(channel: number): number {
  const unit = channel / 255
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
}

/** Relative luminance of an sRGB colour, 0 (black) to 1 (white), as the contrast guidelines define it. */
export function relativeLuminance({ red, green, blue }: Pick<Rgba, 'red' | 'green' | 'blue'>): number {
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue)
}

/** Contrast ratio between two luminances, 1 (none) to 21 (black on white). */
export function contrastRatio(first: number, second: number): number {
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

/** For each page tone, the share (0-1) of a logo's visible pixels that stand out against that page. */
export type VisibleShares = Record<PlateContrast, number>

/**
 * Read raw 4-channel pixels and say, for each page tone, what share of the visible pixels have at
 * least `PLATE_CONTRAST_THRESHOLD` contrast against it. Each pixel counts in proportion to its alpha,
 * so a transparent background counts for nothing. Null when nothing is visible.
 */
export function visibleShares(pixels: Uint8Array): VisibleShares | null {
  const standingOut: VisibleShares = { dark: 0, light: 0 }
  let weight = 0
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3] / 255
    const luminance = relativeLuminance({ red: pixels[offset], green: pixels[offset + 1], blue: pixels[offset + 2] })
    weight += alpha
    for (const tone of PLATE_CONTRASTS) {
      if (contrastRatio(luminance, PAGE_LUMINANCE[tone]) >= PLATE_CONTRAST_THRESHOLD) standingOut[tone] += alpha
    }
  }
  if (weight === 0) return null
  return { dark: standingOut.dark / weight, light: standingOut.light / weight }
}

/** Draw a source small and read how visible it is against each page tone. */
export async function measureVisibleShares(source: Sharp): Promise<VisibleShares | null> {
  const { data } = await source
    .resize(VISIBILITY_SAMPLE_SIDE, VISIBILITY_SAMPLE_SIDE, { fit: 'inside' })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return visibleShares(data)
}

/** Whether too little of a logo stands out against the page tone, so it needs a plate. */
export function logoNeedsPlate({ shares, contrast }: { shares: VisibleShares; contrast: PlateContrast }): boolean {
  return shares[contrast] < PLATE_VISIBLE_SHARE_THRESHOLD
}

/**
 * Decide whether to draw a plate and in what colour. `measureShares` is only called when
 * `contrast` is given, because only then does the answer depend on the logo.
 * - `bg` alone: always a plate in that colour.
 * - `contrast` alone: a plate in the opposite tone, only if too little of the logo stands out.
 * - both: the plate is `bg`, and `contrast` decides whether it appears.
 * A logo with nothing visible gets no plate.
 */
export async function resolvePlate({
  request,
  measureShares,
}: {
  request: PlateRequest
  measureShares: () => Promise<VisibleShares | null>
}): Promise<Plate | null> {
  const { colour, shape, contrast } = request
  if (!contrast) return colour ? { colour, shape } : null
  const shares = await measureShares()
  if (shares === null) return null
  if (!logoNeedsPlate({ shares, contrast })) return null
  return { colour: colour ?? CONTRAST_PLATE_COLOUR[contrast], shape }
}

/**
 * A small memory of measured shares, so the logo is drawn and measured once rather than on
 * every request. When full, the oldest entry goes first. A logo with nothing visible is remembered
 * too (as null).
 */
export function createVisibilityCache({ limit = VISIBILITY_CACHE_LIMIT }: { limit?: number } = {}) {
  const entries = new Map<string, VisibleShares | null>()
  return {
    /** Return the remembered value for `key`, or measure it with `measure` and remember that. */
    async remember(key: string, measure: () => Promise<VisibleShares | null>): Promise<VisibleShares | null> {
      if (entries.has(key)) return entries.get(key)!
      const shares = await measure()
      if (entries.size >= limit) entries.delete(entries.keys().next().value!)
      entries.set(key, shares)
      return shares
    },
    /** Number of remembered entries. */
    get size() {
      return entries.size
    },
  }
}

/** The colour as `#rrggbb`. */
function toHex({ red, green, blue }: Rgba): string {
  return '#' + [red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')
}

/**
 * The plate's shape as markup in a 100 by 100 square. The only things written from outside are
 * the shape name, which is one of three fixed words, and a colour that is rebuilt from numbers,
 * so nothing from the query reaches the markup as text.
 */
export function plateShapeMarkup({ colour, shape }: Plate): string {
  const opacity = colour.alpha < 1 ? ` fill-opacity="${Number(colour.alpha.toFixed(3))}"` : ''
  const paint = `fill="${toHex(colour)}"${opacity}`
  if (shape === 'circle') return `<circle cx="50" cy="50" r="50" ${paint}/>`
  if (shape === 'rounded') {
    return `<rect width="100" height="100" rx="${ROUNDED_CORNER_RADIUS}" ry="${ROUNDED_CORNER_RADIUS}" ${paint}/>`
  }
  return `<rect width="100" height="100" ${paint}/>`
}

/** Whether the root tag of a document names a usable `viewBox`. */
function hasUsableViewBox(rootTag: string): boolean {
  const match = /viewBox\s*=\s*["']([^"']*)["']/i.exec(rootTag)
  if (!match) return false
  const numbers = match[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  return numbers.length === 4 && numbers.every(Number.isFinite) && numbers[2] > 0 && numbers[3] > 0
}

/** Remove one attribute, written with either kind of quote, from a root tag. */
function withoutAttribute(tag: string, name: string): string {
  return tag.replace(new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`), '')
}

/**
 * Wrap a scalable vector image in a new one that draws the plate first and the original, nested
 * and centred, on top. The original keeps its own `viewBox`, so it still scales to fill the box it
 * is given; its root `x`, `y`, `width` and `height` are dropped because the box replaces them.
 * Null when the original has no usable `viewBox` or no closing tag, so the caller can fall back
 * to pixels.
 */
export function wrapSvgWithPlate({ content, plate }: { content: Buffer; plate: Plate }): Buffer | null {
  const document = content.toString('utf8')
  const start = document.indexOf('<svg')
  const rootEnd = document.indexOf('>', start)
  const closing = document.lastIndexOf('</svg>')
  if (start === -1 || rootEnd === -1 || closing === -1) return null
  const originalRoot = document.slice(start, rootEnd + 1)
  if (!hasUsableViewBox(originalRoot)) return null

  const root = ['x', 'y', 'width', 'height'].reduce(withoutAttribute, originalRoot)
  const padding = PLATE_PADDING_RATIO[plate.shape] * 100
  const inner = 100 - 2 * padding
  const box = `x="${padding}" y="${padding}" width="${inner}" height="${inner}"`
  const nested = `<svg ${box}${root.slice(4)}${document.slice(rootEnd + 1, closing + 6)}`
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${plateShapeMarkup(plate)}${nested}</svg>`,
    'utf8',
  )
}

/**
 * The side of the square a plated image is drawn at. A requested width or height sets it (both:
 * the smaller). With neither, a vector source gets a fixed side and a raster keeps its own size
 * plus room for the padding, so the logo itself is not rescaled.
 */
export function computePlateSide({
  target,
  intrinsic,
  isVector,
  shape,
}: {
  target: { w: number | null; h: number | null }
  intrinsic: { width?: number; height?: number }
  isVector: boolean
  shape: PlateShape
}): number {
  const requested = [target.w, target.h].filter((side): side is number => side !== null)
  if (requested.length > 0) return Math.min(...requested)
  if (isVector) return PLATE_DEFAULT_VECTOR_SIDE
  const longest = Math.max(intrinsic.width ?? 1, intrinsic.height ?? 1)
  return Math.ceil(longest / (1 - 2 * PLATE_PADDING_RATIO[shape]))
}

/** Pixel size of the area inside the padding where the logo is fitted. */
export function plateInnerSide({ side, shape }: { side: number; shape: PlateShape }): number {
  return Math.max(1, Math.round(side * (1 - 2 * PLATE_PADDING_RATIO[shape])))
}

/**
 * Draw a logo centred on a plate, as pixels. `logo` is a source opened large enough for
 * `plateInnerSide` (see `openSource`). The logo is fitted inside the padded area and never
 * enlarged. A jpg has no transparency, so its corners are filled white.
 */
export async function renderPlatedRaster({
  logo,
  side,
  plate,
  format,
}: {
  logo: Sharp
  side: number
  plate: Plate
  format: string
}): Promise<Buffer> {
  const inner = plateInnerSide({ side, shape: plate.shape })
  const { data, info } = await logo
    .resize(inner, inner, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true })
  const plateSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 100 100">${plateShapeMarkup(plate)}</svg>`
  const composed = await sharp(Buffer.from(plateSvg))
    .composite([{ input: data, left: Math.round((side - info.width) / 2), top: Math.round((side - info.height) / 2) }])
    .png()
    .toBuffer()
  // Flattening has to happen after the logo is on the plate, or it would not reach the corners.
  const output = sharp(composed)
  const flattened = format === 'jpeg' ? output.flatten({ background: '#ffffff' }) : output
  return flattened.toFormat(format as keyof FormatEnum).toBuffer()
}
