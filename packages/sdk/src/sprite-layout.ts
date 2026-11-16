/**
 * The rules a token sprite sheet is laid out by, shared by the server and by @gibs/sdk.
 *
 * The server draws the sheet and writes the manifest and the stylesheet. The software development
 * kit reads them back and must compute the same token names and the same layout version. Both
 * import this one module, so a rule cannot drift between them.
 *
 * Constraints that keep this file runnable as source:
 *   - it imports nothing, so no other module has to be loaded with it;
 *   - it uses only syntax Node strips (no enums, no parameter properties, type-only imports marked `type`);
 *   - it is pure: the same inputs always give the same outputs, with no clock, no file and no network.
 *
 * Words in this module are spelled out where the rest of the project spells them out: a
 * "stylesheet" is a cascading style sheet, and an "address" is the path the browser fetches.
 */

/** Smallest and largest cell size in CSS pixels. */
export const SPRITE_SIZE_RANGE = {
  minimum: 16,
  maximum: 128,
  fallback: 32,
} as const
/** Fewest and most grid columns. */
export const SPRITE_COLUMNS_RANGE = {
  minimum: 5,
  maximum: 50,
  fallback: 25,
} as const
/** Fewest and most tokens a sheet may hold. */
export const SPRITE_LIMIT_RANGE = {
  minimum: 1,
  maximum: 2000,
  fallback: 500,
} as const
/**
 * The most tokens a plated sheet may hold. Measured on the development machine: a 500-cell contrast sheet
 * takes about 1.9 seconds cold and 1.1 seconds warm; 2000 cells take about 8.5 and 5.6 seconds. A plated
 * request is cut to this many, and the cut is part of the settings, so every endpoint agrees on it.
 */
export const SPRITE_PLATED_LIMIT = 500
/** Space between two cells, in CSS pixels. Whole numbers only; the server refuses anything else. */
export const SPRITE_GAP_RANGE = {
  minimum: 0,
  maximum: 32,
  fallback: 0,
} as const
/** The outlines a plate can take. */
export const SPRITE_PLATE_SHAPES = ['circle', 'rounded', 'square'] as const
/** The page tones `contrast` can name. */
export const SPRITE_PLATE_CONTRASTS = ['dark', 'light'] as const
/** The outline used when `shape` is not given. */
export const SPRITE_DEFAULT_PLATE_SHAPE = 'circle' as const
/** The largest side a WebP image may have, in pixels. */
export const SPRITE_MAXIMUM_SIDE_PIXELS = 16383
/**
 * The most pixels one sheet may cover. About 5000 by 5000. The server builds the whole sheet in memory,
 * so a size larger than this would cost gigabytes at scale 2. Cells beyond it are left off the layout.
 */
export const SPRITE_MAXIMUM_SHEET_PIXELS = 25_000_000

/** Prefix of every token class name. */
export const SPRITE_TOKEN_CLASS_PREFIX = 'gib-'
/** Prefix of the scope class that every stylesheet rule starts with. */
export const SPRITE_SCOPE_CLASS_PREFIX = 'gibsheet-'

/** A plate outline. */
export type SpritePlateShape = (typeof SPRITE_PLATE_SHAPES)[number]
/** A page tone for `contrast`. */
export type SpritePlateContrast = (typeof SPRITE_PLATE_CONTRASTS)[number]

/** Whether a token is drawn as a vector (inlined) or as a raster cell. */
export type SpriteContent = 'grid' | 'mixed'
/** How many sheet pixels one CSS pixel holds. */
export type SpriteScale = 1 | 2

/** What a caller asks for. Every field is optional; {@link normalizeSpriteSettings} fills the rest. */
export interface SpriteRequest {
  /** Cell size in CSS pixels. */
  size?: number | null
  /** Grid columns. */
  cols?: number | null
  /** Most tokens. */
  limit?: number | null
  /** One chain: a namespaced identifier (`eip155-1`) or a bare number. */
  chainId?: string | number | null
  /** `mixed` inlines vector images as data addresses instead of drawing them on the sheet. */
  content?: string | null
  /** Sheet pixels per CSS pixel. Any value other than 2 means 1. */
  scale?: number | null
  /** Space between cells in CSS pixels. */
  gap?: number | null
  /** Plate colour: 3, 6 or 8 hex digits without `#`. Paints a plate behind every cell. */
  bg?: string | null
  /** Plate outline. */
  shape?: string | null
  /** Paints a plate only on cells whose logo does not stand out against this page tone. */
  contrast?: string | null
}

/** The plate a sheet paints behind its cells, in the form that is compared, hashed and addressed. */
export interface SpritePlateSettings {
  /** Lowercase hex colour, 6 or 8 digits. Null when `contrast` alone decides the colour. */
  colour: string | null
  shape: SpritePlateShape
  contrast: SpritePlateContrast | null
}

/** A request with every default applied and every bound enforced. */
export interface SpriteSettings {
  size: number
  cols: number
  limit: number
  scale: SpriteScale
  content: SpriteContent
  chainId: string | null
  gap: number
  plate: SpritePlateSettings | null
}

/**
 * Applies the default and the bounds of one whole-number setting.
 *
 * A value that is missing, not a number, or zero takes the default. Anything else is cut to a whole number
 * and held inside the range.
 *
 * @param value The caller's value.
 * @param range The minimum, maximum and default for the setting.
 * @returns A whole number in range.
 */
function wholeNumberWithin(
  value: number | null | undefined,
  range: { minimum: number; maximum: number; fallback: number },
): number {
  const whole = Math.floor(Number(value))
  if (!whole) return range.fallback
  return Math.min(Math.max(whole, range.minimum), range.maximum)
}

/**
 * Turns a request into the settings the layout is built from.
 *
 * Defaults and bounds are applied here, once, so the server's answer and the software development kit's
 * token names always come from the same numbers. The function is idempotent: normalizing settings again
 * gives the same settings.
 *
 * @param request What the caller asked for.
 * @returns The settings with every default applied.
 */
export function normalizeSpriteSettings(request: SpriteRequest): SpriteSettings {
  const plate = plateSettingsFrom(request)
  const requestedLimit = wholeNumberWithin(request.limit, SPRITE_LIMIT_RANGE)
  return {
    size: wholeNumberWithin(request.size, SPRITE_SIZE_RANGE),
    cols: wholeNumberWithin(request.cols, SPRITE_COLUMNS_RANGE),
    limit: plate ? Math.min(requestedLimit, SPRITE_PLATED_LIMIT) : requestedLimit,
    scale: Number(request.scale) === 2 ? 2 : 1,
    content: request.content === 'mixed' ? 'mixed' : 'grid',
    chainId: isBlank(request.chainId) ? null : String(request.chainId),
    gap: wholeNumberWithin(request.gap, SPRITE_GAP_RANGE),
    plate,
  }
}

/**
 * The plate a request asks for, or null when it asks for none.
 *
 * A plate needs a `bg` colour or a `contrast` tone. A `shape` alone makes no plate. An invalid value is
 * treated as absent here; the server refuses invalid values with a 400 before this runs.
 *
 * @param request What the caller asked for.
 * @returns The plate settings, or null.
 */
function plateSettingsFrom(request: SpriteRequest): SpritePlateSettings | null {
  const colour = typeof request.bg === 'string' ? canonicalHexColour(request.bg) : null
  const contrast = choiceFrom(SPRITE_PLATE_CONTRASTS, request.contrast)
  if (colour === null && contrast === null) return null
  return {
    colour,
    shape: choiceFrom(SPRITE_PLATE_SHAPES, request.shape) ?? SPRITE_DEFAULT_PLATE_SHAPE,
    contrast,
  }
}

/**
 * The choice a value names, compared without regard to case. Null when it names none.
 *
 * @param choices The allowed values.
 * @param value The value given.
 * @returns The matching choice, or null.
 */
export function choiceFrom<Choice extends string>(
  choices: readonly Choice[],
  value: string | null | undefined,
): Choice | null {
  if (typeof value !== 'string') return null
  const lowered = value.toLowerCase()
  return choices.find((choice) => choice === lowered) ?? null
}

/** Three or six hex digits, or eight with alpha last. */
const HEX_COLOUR = /^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * A colour as lowercase hex: three digits are doubled to six, and six or eight are kept. Null when the text is
 * anything else.
 *
 * @param value A colour written without `#`.
 * @returns The canonical colour, or null.
 */
export function canonicalHexColour(value: string): string | null {
  if (!HEX_COLOUR.test(value)) return null
  const lowered = value.toLowerCase()
  if (lowered.length !== 3) return lowered
  return lowered
    .split('')
    .map((digit) => digit + digit)
    .join('')
}

/**
 * Whether a chain filter is absent. An empty string counts as absent, the same as on every list endpoint.
 *
 * @param chainId The chain filter as given.
 * @returns True when there is no filter.
 */
function isBlank(chainId: string | number | null | undefined): boolean {
  return chainId === undefined || chainId === null || chainId === ''
}

/**
 * The chain namespace for a bare number.
 *
 * A number with no namespace is an EVM chain, except `0`, which is the asset namespace. A value that already
 * names its namespace (it contains a dash) is returned unchanged.
 *
 * @param chainId A bare number or a namespaced identifier.
 * @returns The namespaced identifier, for example `eip155-1`.
 */
export function toCaip2ChainId(chainId: string | number): string {
  const text = String(chainId)
  if (text.includes('-')) return text
  if (text === '0') return 'asset-0'
  return `eip155-${text}`
}

/** Hexadecimal with a `0x` prefix. Base58 ids never start with `0x`, so the prefix tells the two apart. */
const HEXADECIMAL_ADDRESS = /^0x[0-9a-fA-F]+$/

/**
 * Lowercases a hexadecimal address and leaves every other id alone.
 *
 * Hexadecimal casing carries no meaning. Base58 ids (Solana mints, Tron addresses) are case-significant, so
 * lowercasing them would merge two different tokens.
 *
 * @param address A token address or id.
 * @returns The lowercase address, or the id unchanged.
 */
export function normalizeSpriteAddress(address: string): string {
  return HEXADECIMAL_ADDRESS.test(address) ? address.toLowerCase() : address
}

/**
 * The key a token has in a sprite manifest: the namespaced chain, a dash, then the address.
 *
 * @param token The chain (bare or namespaced) and the address.
 * @returns The manifest key, for example `eip155-1-0xa0b8…`.
 */
export function spriteTokenKey(token: { chainId: string | number; address: string }): string {
  return `${toCaip2ChainId(token.chainId)}-${normalizeSpriteAddress(token.address)}`
}

/**
 * Whether an image extension is a vector image. The server stores the same extension for SVG and for
 * `svg+xml`, so both count.
 *
 * @param extension The stored extension, for example `.svg`. Null or undefined is not a vector.
 * @returns True for a vector image.
 */
export function isVectorImageExtension(extension: string | null | undefined): boolean {
  return extension === '.svg' || extension === '.svg+xml'
}

/**
 * Encodes a manifest key so it is safe inside a class name, and keeps every distinct key distinct.
 *
 * Lowercase letters, digits and dashes stay. An uppercase letter becomes an underscore and its lowercase
 * form, so `A` and `a` stay apart. An underscore doubles. Any other character becomes an underscore, a zero,
 * and its hexadecimal code point, ended by an underscore. Each underscore starts exactly one of those forms,
 * so the encoding can always be read back.
 *
 * The class names stay case-sensitive in every page mode, including quirks mode, where a selector ignores
 * case. Lowercasing a base58 id would merge distinct mints; this encoding does not.
 *
 * @param key A manifest key.
 * @returns A string of lowercase letters, digits, dashes and underscores.
 */
export function encodeSpriteClassSegment(key: string): string {
  let encoded = ''
  for (const character of key) {
    encoded += encodeSpriteCharacter(character)
  }
  return encoded
}

/**
 * The encoding of one character. See {@link encodeSpriteClassSegment}.
 *
 * @param character One code point.
 * @returns Its encoded form.
 */
function encodeSpriteCharacter(character: string): string {
  if (/^[a-z0-9-]$/.test(character)) return character
  if (/^[A-Z]$/.test(character)) return `_${character.toLowerCase()}`
  if (character === '_') return '__'
  return `_0${character.codePointAt(0)!.toString(16)}_`
}

/**
 * The class name a token carries on a page.
 *
 * @param key A manifest key.
 * @returns A class name made of lowercase letters, digits, dashes and underscores.
 */
export function spriteTokenClassName(key: string): string {
  return `${SPRITE_TOKEN_CLASS_PREFIX}${encodeSpriteClassSegment(key)}`
}

/**
 * The class name for a token on a page. A page applies it with its list's scope class.
 *
 * @param chainId The chain, bare or namespaced.
 * @param address The token address.
 * @returns The class name, for example `gib-eip155-1-0xa0b8…`.
 */
export function spriteClassName(chainId: string | number, address: string): string {
  return spriteTokenClassName(spriteTokenKey({ chainId, address }))
}

/**
 * The 53-bit hash the layout version and the scope class are built from.
 *
 * This is cyrb53, a published non-cryptographic hash. It is synchronous and pure, so the browser and the
 * server compute the same value. It guards against mixing data by accident, not against deliberate forgery.
 *
 * @param text Any text.
 * @returns Fourteen lowercase hexadecimal digits.
 */
export function hashSpriteText(text: string): string {
  let firstHash = 0xdeadbeef
  let secondHash = 0x41c6ce57
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    firstHash = Math.imul(firstHash ^ code, 2654435761)
    secondHash = Math.imul(secondHash ^ code, 1597334677)
  }
  firstHash = Math.imul(firstHash ^ (firstHash >>> 16), 2246822507)
  firstHash ^= Math.imul(secondHash ^ (secondHash >>> 13), 3266489909)
  secondHash = Math.imul(secondHash ^ (secondHash >>> 16), 2246822507)
  secondHash ^= Math.imul(firstHash ^ (firstHash >>> 13), 3266489909)
  const value = 4294967296 * (2097151 & secondHash) + (firstHash >>> 0)
  return value.toString(16).padStart(14, '0')
}

/** One token as the layout sees it: its key, and whether its image is a vector. */
export interface SpriteEntry {
  key: string
  vector: boolean
}

/** A token drawn as a raster cell on the sheet. `source` is its position in the entries it came from. */
export interface SpriteCellPlacement {
  kind: 'cell'
  key: string
  source: number
  /** Cell number, counted from zero in list order. */
  index: number
  column: number
  row: number
}

/** A vector token inlined as a data address. It takes no cell. */
export interface SpriteInlinePlacement {
  kind: 'inline'
  key: string
  source: number
}

/** Where one token goes. */
export type SpritePlacement = SpriteCellPlacement | SpriteInlinePlacement

/** The complete layout of one sheet. */
export interface SpriteLayout {
  settings: SpriteSettings
  /** Every token that has a place, in list order. A token beyond the sheet's capacity has none. */
  placements: SpritePlacement[]
  /** Pixels a cell covers on the sheet: size times scale. */
  cellPixels: number
  /** Pixels between two cells on the sheet: gap times scale. */
  gapPixels: number
  /** Pixels from one cell's corner to the next: the cell plus the gap. */
  pitchPixels: number
  /** Grid rows the cells fill. */
  rows: number
  /** Sheet width in pixels. */
  sheetWidth: number
  /** Sheet height in pixels. At least one. */
  sheetHeight: number
  /** The hash of the settings and the placements. Changes whenever a token's place changes. */
  version: string
}

/**
 * The most cells one sheet may hold at this pitch and column count.
 *
 * The sheet is limited by both its side and its total pixels, so the rows that fit are the smaller of the
 * two counts. The pitch is a cell plus the gap after it.
 *
 * @param columns Grid columns.
 * @param pitchPixels Sheet pixels from one cell's corner to the next.
 * @returns The most cells.
 */
export function maximumSpriteCells(columns: number, pitchPixels: number): number {
  const rowsBySide = Math.floor(SPRITE_MAXIMUM_SIDE_PIXELS / pitchPixels)
  const rowsByPixels = Math.floor(SPRITE_MAXIMUM_SHEET_PIXELS / (columns * pitchPixels * pitchPixels))
  return columns * Math.min(rowsBySide, rowsByPixels)
}

/**
 * Decides where every token goes.
 *
 * Tokens keep the order they are given in, which the server takes from the list's own order. The first
 * occurrence of a key wins. A vector under `content=mixed` is inlined and takes no cell, so it never moves
 * a raster. A raster past the sheet's capacity has no place. The layout depends only on the entries and the
 * settings, never on image bytes, so the same list always gets the same layout.
 *
 * @param entries The tokens, in list order.
 * @param settings The normalized settings (see {@link normalizeSpriteSettings}).
 * @returns The layout.
 */
export function planSpriteLayout(entries: SpriteEntry[], settings: SpriteSettings): SpriteLayout {
  const cellPixels = settings.size * settings.scale
  const gapPixels = settings.gap * settings.scale
  const pitchPixels = cellPixels + gapPixels
  const capacity = maximumSpriteCells(settings.cols, pitchPixels)
  const placements: SpritePlacement[] = []
  const seenKeys = new Set<string>()
  let cellCount = 0
  entries.forEach((entry, source) => {
    if (seenKeys.has(entry.key)) return
    seenKeys.add(entry.key)
    if (settings.content === 'mixed' && entry.vector) {
      placements.push({ kind: 'inline', key: entry.key, source })
      return
    }
    if (cellCount >= capacity) return
    placements.push({
      kind: 'cell',
      key: entry.key,
      source,
      index: cellCount,
      column: cellCount % settings.cols,
      row: Math.floor(cellCount / settings.cols),
    })
    cellCount++
  })
  const rows = Math.ceil(cellCount / settings.cols)
  return {
    settings,
    placements,
    cellPixels,
    gapPixels,
    pitchPixels,
    rows,
    sheetWidth: settings.cols * pitchPixels,
    sheetHeight: Math.max(rows * pitchPixels, 1),
    version: hashSpriteText(JSON.stringify(versionInput(settings, placements))),
  }
}

/**
 * What the layout version is computed from: the sizing, the gap, the plate and every placement, in order.
 * A cached manifest must never pair with a sheet drawn with different plate options, so all of them count.
 *
 * @param settings The normalized settings.
 * @param placements Where each token goes.
 * @returns A JSON-serializable value.
 */
function versionInput(settings: SpriteSettings, placements: SpritePlacement[]): unknown[] {
  const placed = placements.map((placement) =>
    placement.kind === 'cell' ? [placement.key, 'cell', placement.index] : [placement.key, 'inline'],
  )
  return [settings.size, settings.cols, settings.scale, settings.gap, settings.plate, placed]
}

/**
 * The scope class every rule of one list's stylesheet starts with.
 *
 * It is a function of the provider, the list and the normalized settings, and never of the layout version,
 * so a page can compute it without asking the server. Two lists on one page, or one list at two sizes, get
 * two scopes, so their token classes never collide.
 *
 * @param provider The provider key.
 * @param listKey The list key.
 * @param request What the caller asked for.
 * @returns A class name, for example `gibsheet-0123…`.
 */
export function spriteScopeClassName(provider: string, listKey: string, request: SpriteRequest): string {
  const settings = normalizeSpriteSettings(request)
  return `${SPRITE_SCOPE_CLASS_PREFIX}${hashSpriteText(JSON.stringify([provider, listKey, settings]))}`
}

/**
 * Builds a query string from the values that are set. A value that is `undefined` is left out.
 *
 * The order of the keys is the order of the object, so two callers that pass the same values in the same
 * order get the same address.
 *
 * @param values The parameters and their values.
 * @returns The query string, without a leading question mark.
 */
export function buildSpriteQuery(values: Record<string, string | number | undefined>): string {
  const parameters = new URLSearchParams()
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) parameters.set(name, String(value))
  }
  return parameters.toString()
}

/**
 * The query values a fully normalized layout is addressed by.
 *
 * @param settings The normalized settings.
 * @param version The layout version to pin, when the address should name one.
 * @returns The values for {@link buildSpriteQuery}.
 */
export function spriteQueryValues(
  settings: SpriteSettings,
  version: string | undefined,
): Record<string, string | number | undefined> {
  return {
    size: settings.size,
    cols: settings.cols,
    limit: settings.limit,
    chainId: settings.chainId ?? undefined,
    content: settings.content === 'mixed' ? 'mixed' : undefined,
    scale: settings.scale,
    gap: settings.gap || undefined,
    bg: settings.plate?.colour ?? undefined,
    shape: settings.plate ? settings.plate.shape : undefined,
    contrast: settings.plate?.contrast ?? undefined,
    v: version,
  }
}

/**
 * Escapes text for use inside a double-quoted CSS string.
 *
 * @param value Any text.
 * @returns Text that cannot end the string or start a new declaration.
 */
export function escapeCssString(value: string): string {
  return value
    .replace(/["\\]/g, '\\$&')
    .replace(/[\r\n\f]/g, (character) => `\\${character.codePointAt(0)!.toString(16)} `)
}

/** A rule for a raster token: where its cell sits on the sheet. */
export interface SpriteCellRule {
  kind: 'cell'
  key: string
  column: number
  row: number
}

/** A rule for an inlined vector token: its data address. */
export interface SpriteInlineRule {
  kind: 'inline'
  key: string
  dataAddress: string
}

/** One rule of a stylesheet. */
export type SpriteStylesheetRule = SpriteCellRule | SpriteInlineRule

/**
 * Renders a list's stylesheet.
 *
 * The scope class sets the box and the sheet picture. Each token rule sets the position of its cell, or
 * replaces the picture with its own data address. A token rule carries the scope as well as its own class,
 * so it outranks the scope rule and can override it.
 *
 * @param input.scope The scope class (see {@link spriteScopeClassName}).
 * @param input.sheetAddress The address of the sheet, root-relative so it resolves against the stylesheet's
 *   own address, which is the same server.
 * @param input.settings The normalized settings.
 * @param input.rules One rule per token that has a picture.
 * @returns The stylesheet text.
 */
export function renderSpriteStylesheet(input: {
  scope: string
  sheetAddress: string
  settings: SpriteSettings
  rules: SpriteStylesheetRule[]
}): string {
  const { scope, sheetAddress, settings, rules } = input
  const size = settings.size
  const pitch = settings.size + settings.gap
  const base = [
    `.${scope} {`,
    '  display: inline-block;',
    `  width: ${size}px;`,
    `  height: ${size}px;`,
    `  background-image: url("${escapeCssString(sheetAddress)}");`,
    '  background-repeat: no-repeat;',
    `  background-size: ${settings.cols * pitch}px auto;`,
    '}',
  ]
  const tokenRules = rules.map((rule) => renderTokenRule(scope, pitch, rule))
  return [...base, ...tokenRules].join('\n').concat('\n')
}

/**
 * The rule for one token.
 *
 * @param scope The scope class.
 * @param pitch Distance from one cell's corner to the next in CSS pixels: size plus gap.
 * @param rule The token's rule.
 * @returns The rule's text.
 */
function renderTokenRule(scope: string, pitch: number, rule: SpriteStylesheetRule): string {
  const selector = `.${scope}.${spriteTokenClassName(rule.key)}`
  if (rule.kind === 'inline') {
    return [
      `${selector} {`,
      `  background-image: url("${escapeCssString(rule.dataAddress)}");`,
      '  background-size: contain;',
      '  background-position: center;',
      '}',
    ].join('\n')
  }
  return [`${selector} {`, `  background-position: ${-rule.column * pitch}px ${-rule.row * pitch}px;`, '}'].join('\n')
}
