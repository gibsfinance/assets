import { useMemo } from 'react'
import { useGib } from './provider'
import GibImage, { type GibImageProps } from './gib-image'
import type { ImageOptions } from '@gibs/sdk'

export interface TokenImageProps extends Omit<GibImageProps, 'src'> {
  /** EVM chain ID */
  chainId: number
  /** Token contract address */
  address: string
  /** Image format (default: webp) */
  format?: ImageOptions['format']
  /** Override the base URL (skips GibProvider) */
  baseUrl?: string
}

/**
 * Renders a token image with automatic URL resolution, Retina sizing, and WebP format.
 *
 * @example
 * ```tsx
 * <GibProvider>
 *   <TokenImage chainId={1} address="0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" size={32} />
 * </GibProvider>
 * ```
 */
export function TokenImage({
  chainId,
  address,
  format = 'webp',
  baseUrl: baseUrlOverride,
  size = 32,
  width,
  height,
  ...rest
}: TokenImageProps) {
  let client: ReturnType<typeof useGib> | null = null
  try {
    client = useGib()
  } catch {
    // GibProvider not available — use baseUrl or production default
  }

  const resolvedBaseUrl = baseUrlOverride || client?.baseUrl || 'https://gib.show'
  const w = width || size
  const h = height || size

  const src = useMemo(
    () =>
      `${resolvedBaseUrl}/image/${chainId}/${address}?w=${w * 2}&h=${h * 2}&format=${format}`,
    [resolvedBaseUrl, chainId, address, w, h, format],
  )

  return <GibImage src={src} size={size} width={width} height={height} {...rest} />
}
