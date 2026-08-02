import { useMemo } from 'react'
import { useGib } from './provider'
import GibImage, { type GibImageProps } from './gib-image'
import { getNetworkImageUrl, type ChainId, type ImageOptions } from '@gibs/sdk'

export interface NetworkImageProps extends Omit<GibImageProps, 'src'> {
  /**
   * The chain, as a namespaced identifier (`'eip155-1'`, `'solana-501'`) or the
   * bare number. Prefer the identifier — eleven numbers name two chains each.
   */
  chainId: ChainId
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
 *   <NetworkImage chainId="eip155-1" size={24} />
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

  // Built through the SDK rather than inline: the two used to spell the format
  // param differently, and only the SDK's spelling is the one the server reads.
  const src = useMemo(
    () => getNetworkImageUrl(resolvedBaseUrl, chainId, { width: w * 2, height: h * 2, format }),
    [resolvedBaseUrl, chainId, w, h, format],
  )

  return <GibImage src={src} size={size} width={width} height={height} {...rest} />
}
