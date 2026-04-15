import { useMemo } from 'react'
import { useGib } from './provider'
import GibImage, { type GibImageProps } from './gib-image'
import type { ImageOptions } from '@gibs/sdk'

export interface NetworkImageProps extends Omit<GibImageProps, 'src'> {
  /** EVM chain ID */
  chainId: number
  /** Image format (default: webp) */
  format?: ImageOptions['format']
  /** Override the base URL (skips GibProvider) */
  baseUrl?: string
}

/**
 * Renders a network/chain logo with automatic URL resolution.
 *
 * @example
 * ```tsx
 * <GibProvider>
 *   <NetworkImage chainId={1} size={24} />
 * </GibProvider>
 * ```
 */
export function NetworkImage({
  chainId,
  format = 'webp',
  baseUrl: baseUrlOverride,
  size = 24,
  width,
  height,
  ...rest
}: NetworkImageProps) {
  let client: ReturnType<typeof useGib> | null = null
  try {
    client = useGib()
  } catch {
    // GibProvider not available
  }

  const resolvedBaseUrl = baseUrlOverride || client?.baseUrl || 'https://gib.show'
  const w = width || size
  const h = height || size

  const src = useMemo(
    () => `${resolvedBaseUrl}/image/${chainId}?w=${w * 2}&h=${h * 2}&format=${format}`,
    [resolvedBaseUrl, chainId, w, h, format],
  )

  return <GibImage src={src} size={size} width={width} height={height} {...rest} />
}
