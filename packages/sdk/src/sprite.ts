import type { ChainId } from './image'
import {
  buildSpriteQuery,
  normalizeSpriteAddress,
  spriteScopeClassName,
  spriteTokenKey,
  type SpritePlateContrast,
  type SpritePlateSettings,
  type SpritePlateShape,
  type SpriteScale,
} from './sprite-layout'

/** Options for fetching a sprite */
export interface SpriteOptions {
  /** Icon size in CSS pixels (default: 32) */
  size?: number
  /** Grid columns (default: 25) */
  cols?: number
  /** Max tokens (default: 500) */
  limit?: number
  /**
   * Filter to a specific chain within the list — namespaced (`solana-501`) or
   * bare (`501`). A bare number matches every chain carrying that reference,
   * which for the eleven doubly-claimed numbers is more than one chain.
   */
  chainId?: ChainId
  /** 'mixed' returns SVGs as inline data URIs, rasters in the sprite grid */
  content?: 'mixed'
  /**
   * Sheet pixels per CSS pixel (default: 1). 2 draws the sheet at twice the resolution,
   * for screens with a high pixel density. Positions and sizes stay in CSS pixels.
   */
  scale?: SpriteScale
  /** Space between cells in CSS pixels, from 0 (the default) to 32. Keeps neighbouring logos apart. */
  gap?: number
  /** Plate colour: 3, 6 or 8 hex digits without `#`. Paints a plate behind every cell. */
  bg?: string
  /** Plate outline (default: circle). */
  shape?: SpritePlateShape
  /** Paints a plate only on cells whose logo does not stand out against this page tone. */
  contrast?: SpritePlateContrast
}

/** Position of a raster icon in the sprite grid */
export type SpritePosition = [col: number, row: number]

/** A token entry is either a grid position [col, row] or an inline SVG data URI */
export type SpriteTokenEntry = SpritePosition | string

/**
 * Manifest returned by the sprite endpoint.
 *
 * `stylesheetUrl`, `scale` and `version` are absent from a server that predates
 * the stylesheet. Read them as optional.
 */
export interface SpriteManifest {
  spriteUrl: string
  stylesheetUrl?: string
  size: number
  scale?: SpriteScale
  cols: number
  rows: number
  rasterCount: number
  svgCount: number
  count: number
  /** Changes whenever a token moves, or the gap or plate changes. Pinned in `spriteUrl` and `stylesheetUrl`. */
  version?: string
  /** Space between cells in CSS pixels. */
  gap?: number
  /** The plate painted behind each cell, or null when there is none. */
  plate?: SpritePlateSettings | null
  tokens: Record<string, SpriteTokenEntry>
}

/** Resolved icon — either a sprite crop or an inline SVG */
export type ResolvedIcon =
  { type: 'sprite'; url: string; x: number; y: number; size: number } | { type: 'svg'; dataUri: string } | null

/** A loaded sprite with helper methods for looking up token icons */
export interface Sprite {
  /** The manifest data */
  manifest: SpriteManifest
  /** Full URL to the sprite sheet image */
  sheetUrl: string
  /** Full URL to the list's stylesheet, when the server provides one */
  stylesheetUrl: string | null
  /** Look up an icon by chainId + address. Accepts `1` or `eip155-1`. */
  getIcon(chainId: ChainId, address: string): ResolvedIcon
  /** Get CSS background properties for a raster icon */
  getBackgroundCSS(chainId: ChainId, address: string): Record<string, string> | null
  /** Check if a token has an icon in this sprite */
  has(chainId: ChainId, address: string): boolean
  /** All token keys in the sprite, verbatim as the server served them */
  keys(): string[]
}

/**
 * The query string for a set of options. Only the options the caller gave are sent,
 * so the server applies its own defaults to the rest.
 *
 * @param options What the caller set.
 * @returns The query string with a leading `?`, or an empty string when there is none.
 */
function queryFor(options?: SpriteOptions): string {
  const query = buildSpriteQuery({
    size: options?.size || undefined,
    cols: options?.cols || undefined,
    limit: options?.limit || undefined,
    chainId: options?.chainId ? String(options.chainId) : undefined,
    content: options?.content,
    scale: options?.scale,
    gap: options?.gap || undefined,
    bg: options?.bg,
    shape: options?.shape,
    contrast: options?.contrast,
  })
  return query ? `?${query}` : ''
}

/** Build a sprite manifest URL */
export function getSpriteUrl(baseUrl: string, provider: string, listKey: string, options?: SpriteOptions): string {
  return `${baseUrl}/sprite/${provider}/${listKey}${queryFor(options)}`
}

/** Build a sprite sheet (image) URL */
export function getSpriteSheetUrl(baseUrl: string, provider: string, listKey: string, options?: SpriteOptions): string {
  return `${baseUrl}/sprite/${provider}/${listKey}/sheet${queryFor(options)}`
}

/**
 * Build a stylesheet URL. The stylesheet gives each token a class, and the page applies
 * it with the scope class from {@link getSpriteScopeClass}.
 *
 * @param baseUrl The instance's base address.
 * @param provider The provider key.
 * @param listKey The list key.
 * @param options The same options the manifest and the sheet take.
 * @returns The stylesheet address.
 */
export function getSpriteStylesheetUrl(
  baseUrl: string,
  provider: string,
  listKey: string,
  options?: SpriteOptions,
): string {
  return `${baseUrl}/sprite/${provider}/${listKey}/sheet.css${queryFor(options)}`
}

/**
 * The scope class a list's stylesheet is written under. Apply it with the token class
 * (see `spriteClassName`) to show that token's picture.
 *
 * The name is computed from the provider, the list and the options, so it matches the
 * server's without a request. Give the same options to the stylesheet and to this function.
 *
 * @param provider The provider key.
 * @param listKey The list key.
 * @param options The same options given to {@link getSpriteStylesheetUrl}.
 * @returns A class name, for example `gibsheet-0123…`.
 */
export function getSpriteScopeClass(provider: string, listKey: string, options?: SpriteOptions): string {
  return spriteScopeClassName(provider, listKey, {
    size: options?.size,
    cols: options?.cols,
    limit: options?.limit,
    chainId: options?.chainId,
    content: options?.content,
    scale: options?.scale,
    gap: options?.gap,
    bg: options?.bg,
    shape: options?.shape,
    contrast: options?.contrast,
  })
}

/**
 * Whether a manifest key was written with an uppercase hexadecimal address. Keys are read back
 * as the server wrote them, so only the lookup index changes case.
 *
 * @param key A key as the server served it.
 * @returns The key with its address lowercased when the address is hexadecimal.
 */
function foldKey(key: string): string {
  const cut = key.lastIndexOf('-')
  if (cut === -1) return key
  return `${key.slice(0, cut + 1)}${normalizeSpriteAddress(key.slice(cut + 1))}`
}

/** Fetch and parse a sprite manifest, returning a Sprite with lookup helpers */
export async function fetchSprite(
  baseUrl: string,
  provider: string,
  listKey: string,
  options?: SpriteOptions,
): Promise<Sprite> {
  const url = getSpriteUrl(baseUrl, provider, listKey, options)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch sprite manifest: ${res.status}`)
  const manifest: SpriteManifest = await res.json()

  // The manifest is exposed exactly as served — `keys()` hands back the server's
  // own ids. Lookups go through a separate case-folded index so tolerating hex
  // casing never rewrites the addresses callers read back.
  const index: Record<string, SpriteTokenEntry> = {}
  for (const [key, value] of Object.entries(manifest.tokens)) {
    index[foldKey(key)] = value
  }

  const sheetUrl = resolveAddress(baseUrl, manifest.spriteUrl)
  const stylesheetUrl = manifest.stylesheetUrl ? resolveAddress(baseUrl, manifest.stylesheetUrl) : null

  function getIcon(chainId: ChainId, address: string): ResolvedIcon {
    const entry = index[spriteTokenKey({ chainId, address })]
    if (!entry) return null

    if (typeof entry === 'string') {
      return { type: 'svg', dataUri: entry }
    }

    const [col, row] = entry
    return {
      type: 'sprite',
      url: sheetUrl,
      x: col * manifest.size,
      y: row * manifest.size,
      size: manifest.size,
    }
  }

  function getBackgroundCSS(chainId: ChainId, address: string): Record<string, string> | null {
    const icon = getIcon(chainId, address)
    if (!icon) return null

    if (icon.type === 'svg') {
      return {
        backgroundImage: `url("${icon.dataUri}")`,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
      }
    }

    return {
      backgroundImage: `url("${icon.url}")`,
      backgroundPosition: `${icon.x === 0 ? '0px' : `-${icon.x}px`} ${icon.y === 0 ? '0px' : `-${icon.y}px`}`,
      backgroundSize: `${manifest.cols * manifest.size}px auto`,
      backgroundRepeat: 'no-repeat',
    }
  }

  return {
    manifest,
    sheetUrl,
    stylesheetUrl,
    getIcon,
    getBackgroundCSS,
    has(chainId: ChainId, address: string): boolean {
      return spriteTokenKey({ chainId, address }) in index
    },
    keys(): string[] {
      return Object.keys(manifest.tokens)
    },
  }
}

/**
 * Turns an address the server gave into a full address. A root-relative address is joined to the base address.
 *
 * @param baseUrl The instance's base address.
 * @param address The address the manifest carries.
 * @returns The full address.
 */
function resolveAddress(baseUrl: string, address: string): string {
  return address.startsWith('/') ? `${baseUrl}${address}` : address
}
