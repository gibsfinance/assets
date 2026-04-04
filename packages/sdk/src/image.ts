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
  if (options.format) params.set('format', options.format)
  if (options.providerKey) params.set('providerKey', options.providerKey)
  if (options.listKey) params.set('listKey', options.listKey)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Build a token image URL */
export function getImageUrl(
  baseUrl: string,
  chainId: number,
  address: string,
  options?: ImageOptions,
): string {
  return `${baseUrl}/image/${chainId}/${address}${buildQueryString(options)}`
}

/** Build a network/chain logo URL */
export function getNetworkImageUrl(
  baseUrl: string,
  chainId: number,
  options?: ImageOptions,
): string {
  return `${baseUrl}/image/${chainId}${buildQueryString(options)}`
}

/**
 * Shorthand: build an optimized thumbnail URL.
 * Requests 2x the display size for Retina, WebP format.
 */
export function getThumbnailUrl(
  baseUrl: string,
  chainId: number,
  address: string,
  displaySize: number,
): string {
  return getImageUrl(baseUrl, chainId, address, {
    width: displaySize * 2,
    height: displaySize * 2,
    format: 'webp',
  })
}
