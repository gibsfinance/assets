/** Options for fetching a sprite */
export interface SpriteOptions {
  /** Icon size in pixels (default: 32) */
  size?: number
  /** Grid columns (default: 25) */
  cols?: number
  /** Max tokens (default: 500) */
  limit?: number
  /** Filter to a specific chain within the list */
  chainId?: number
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
  /** Look up an icon by chainId + address */
  getIcon(chainId: number, address: string): ResolvedIcon
  /** Get CSS background properties for a raster icon */
  getBackgroundCSS(chainId: number, address: string): Record<string, string> | null
  /** Check if a token has an icon in this sprite */
  has(chainId: number, address: string): boolean
  /** All token keys in the sprite */
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

function tokenKey(chainId: number, address: string): string {
  return `${chainId}-${address.toLowerCase()}`
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

  const sheetUrl = manifest.spriteUrl.startsWith('/')
    ? `${baseUrl}${manifest.spriteUrl}`
    : manifest.spriteUrl

  function getIcon(chainId: number, address: string): ResolvedIcon {
    const entry = manifest.tokens[tokenKey(chainId, address)]
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

  function getBackgroundCSS(chainId: number, address: string): Record<string, string> | null {
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
    has(chainId: number, address: string): boolean {
      return tokenKey(chainId, address) in manifest.tokens
    },
    keys(): string[] {
      return Object.keys(manifest.tokens)
    },
  }
}
