/**
 * A chain, named either by its namespaced identifier (`eip155-1`, `solana-501`,
 * `bip122-0`) or by the bare number the token list format carries.
 *
 * Prefer the identifier. Eleven numbers are claimed by two namespaces each, so a
 * bare `501` cannot say whether it means Solana or Columbus testnet, and the
 * server is left to resolve it — ambiguously, in those eleven cases. Every image
 * and list endpoint accepts both forms.
 */
export type ChainId = number | string

export interface ImageOptions {
  /** Target width in pixels (1-2048) */
  width?: number
  /** Target height in pixels (1-2048) */
  height?: number
  /** Output format */
  format?: 'webp' | 'png' | 'jpg' | 'avif'
  /** Filter by provider key */
  providerKey?: string
  /** Filter by list key */
  listKey?: string
}

function buildQueryString(options?: ImageOptions): string {
  if (!options) return ''
  const params = new URLSearchParams()
  if (options.width) params.set('w', String(options.width))
  if (options.height) params.set('h', String(options.height))
  // `as`, not `format`: the server reads the output format from `?as=` and
  // ignores anything else, so every request this SDK built asking for WebP was
  // silently served the stored original — 7.9 KB of PNG where 2.3 KB of WebP
  // was asked for.
  if (options.format) params.set('as', options.format)
  if (options.providerKey) params.set('providerKey', options.providerKey)
  if (options.listKey) params.set('listKey', options.listKey)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Build a token image URL */
export function getImageUrl(baseUrl: string, chainId: ChainId, address: string, options?: ImageOptions): string {
  return `${baseUrl}/image/${chainId}/${address}${buildQueryString(options)}`
}

/** Build a network/chain logo URL */
export function getNetworkImageUrl(baseUrl: string, chainId: ChainId, options?: ImageOptions): string {
  return `${baseUrl}/image/${chainId}${buildQueryString(options)}`
}

/**
 * Shorthand: build an optimized thumbnail URL.
 * Requests 2x the display size for Retina, WebP format.
 */
export function getThumbnailUrl(baseUrl: string, chainId: ChainId, address: string, displaySize: number): string {
  return getImageUrl(baseUrl, chainId, address, {
    width: displaySize * 2,
    height: displaySize * 2,
    format: 'webp',
  })
}
