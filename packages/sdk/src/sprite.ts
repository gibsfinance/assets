import type { ChainId } from './image'

/** Options for fetching a sprite */
export interface SpriteOptions {
  /** Icon size in pixels (default: 32) */
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
}

/** Position of a raster icon in the sprite grid */
export type SpritePosition = [col: number, row: number]

/** A token entry is either a grid position [col, row] or an inline SVG data URI */
export type SpriteTokenEntry = SpritePosition | string

/** Manifest returned by the sprite endpoint */
export interface SpriteManifest {
  spriteUrl: string
  size: number
  cols: number
  rows: number
  rasterCount: number
  svgCount: number
  count: number
  tokens: Record<string, SpriteTokenEntry>
}

/** Resolved icon — either a sprite crop or an inline SVG */
export type ResolvedIcon =
  | { type: 'sprite'; url: string; x: number; y: number; size: number }
  | { type: 'svg'; dataUri: string }
  | null

/** A loaded sprite with helper methods for looking up token icons */
export interface Sprite {
  /** The manifest data */
  manifest: SpriteManifest
  /** Full URL to the sprite sheet image */
  sheetUrl: string
  /** Look up an icon by chainId + address. Accepts `1` or `eip155-1`. */
  getIcon(chainId: ChainId, address: string): ResolvedIcon
  /** Get CSS background properties for a raster icon */
  getBackgroundCSS(chainId: ChainId, address: string): Record<string, string> | null
  /** Check if a token has an icon in this sprite */
  has(chainId: ChainId, address: string): boolean
  /** All token keys in the sprite, verbatim as the server served them */
  keys(): string[]
}

function buildSpriteUrl(
  baseUrl: string,
  provider: string,
  listKey: string,
  options?: SpriteOptions,
): string {
  const params = new URLSearchParams()
  if (options?.size) params.set('size', String(options.size))
  if (options?.cols) params.set('cols', String(options.cols))
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.chainId) params.set('chainId', String(options.chainId))
  if (options?.content) params.set('content', options.content)
  const qs = params.toString()
  return `${baseUrl}/sprite/${provider}/${listKey}${qs ? `?${qs}` : ''}`
}

/** Build a sprite manifest URL */
export function getSpriteUrl(
  baseUrl: string,
  provider: string,
  listKey: string,
  options?: SpriteOptions,
): string {
  return buildSpriteUrl(baseUrl, provider, listKey, options)
}

/** Build a sprite sheet (image) URL */
export function getSpriteSheetUrl(
  baseUrl: string,
  provider: string,
  listKey: string,
  options?: SpriteOptions,
): string {
  return buildSpriteUrl(baseUrl, provider, listKey, options).replace(
    `/sprite/${provider}/${listKey}`,
    `/sprite/${provider}/${listKey}/sheet`,
  )
}

/**
 * A hex address, the only token id whose casing carries no meaning.
 *
 * Base58 ids (Solana mints, Tron addresses) never begin `0x` — the alphabet
 * excludes `0` — so the prefix alone separates the two families, and neither
 * form contains a dash. That makes the final dash-separated segment of a
 * manifest key unambiguously the address, however many dashes the chain
 * identifier ahead of it carries.
 */
const HEX_ADDRESS = /^0x[0-9a-fA-F]+$/

/**
 * Canonical CAIP-2 identifier, mirroring the server's `toCAIP2`.
 *
 * The dash form (`eip155-1`, not `eip155:1`) is what the server stores in
 * `network.chain_id` and therefore what its sprite keys carry.
 */
function toCAIP2(chainId: ChainId): string {
  const input = String(chainId)
  if (input.includes('-')) return input
  if (input === '0') return 'asset-0'
  return `eip155-${input}`
}

/** Lowercase hex addresses only; base58 ids are case-significant and pass through. */
function normalizeAddress(address: string): string {
  return HEX_ADDRESS.test(address) ? address.toLowerCase() : address
}

/**
 * The manifest key for a token, matching the server's `spriteKey` exactly.
 *
 * The chain component is the full identifier, not the bare number. The server has
 * keyed sprites this way since chain ids became CAIP-2, but this builder emitted
 * `1-0x…` against a manifest carrying `eip155-1-0x…`. Since `getIcon`, `has`, and
 * `getBackgroundCSS` all declared `chainId: number`, a bare number was the only
 * value a caller could pass without violating the signature — and it missed on
 * every chain. Lookups only ever succeeded by passing a CAIP-2 string the types
 * rejected. The unit tests did not catch it because their fixture manifest was
 * hand-written in the same bare-number shape, so both halves agreed with each
 * other and neither agreed with the server.
 */
function tokenKey(chainId: ChainId, address: string): string {
  return `${toCAIP2(chainId)}-${normalizeAddress(address)}`
}

/**
 * Case-fold a manifest key so a hex address matches whatever casing the caller
 * passes, while a base58 id keeps every byte.
 *
 * Folding the whole key — as this module used to, with a blanket `toLowerCase()`
 * over `Object.entries` — collided distinct Solana mints that differ only in case
 * and handed `keys()` corrupted addresses. The server's own `spriteKey` carries a
 * comment warning against precisely that.
 */
function foldKey(key: string): string {
  const cut = key.lastIndexOf('-')
  if (cut === -1) return key
  const address = key.slice(cut + 1)
  if (!HEX_ADDRESS.test(address)) return key
  return `${key.slice(0, cut + 1)}${address.toLowerCase()}`
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

  const sheetUrl = manifest.spriteUrl.startsWith('/')
    ? `${baseUrl}${manifest.spriteUrl}`
    : manifest.spriteUrl

  function getIcon(chainId: ChainId, address: string): ResolvedIcon {
    const entry = index[tokenKey(chainId, address)]
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
    getIcon,
    getBackgroundCSS,
    has(chainId: ChainId, address: string): boolean {
      return tokenKey(chainId, address) in index
    },
    keys(): string[] {
      return Object.keys(manifest.tokens)
    },
  }
}
