import { useMemo } from 'react'
import { useOptionalGib } from './provider.js'
import GibImage, { type GibImageProps } from './gib-image.js'
import { getImageUrl, type ChainId, type ImageOptions } from '@gibs/sdk'

export interface TokenImageProps extends Omit<GibImageProps, 'src'> {
  /**
   * The chain, as a namespaced identifier (`'eip155-1'`, `'solana-501'`) or the
   * bare number. Prefer the identifier — eleven numbers name two chains each.
   */
  chainId: ChainId
  /** Token contract address, or the chain's native address format */
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
 *   <TokenImage chainId="eip155-1" address="0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" size={32} />
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
  // Without a provider the base address is the one given, or the production default.
  const client = useOptionalGib()

  const resolvedBaseUrl = baseUrlOverride || client?.baseUrl || 'https://gib.show'
  const w = width || size
  const h = height || size

  // Built through the SDK rather than inline: the two used to spell the format
  // param differently, and only the SDK's spelling is the one the server reads.
  const src = useMemo(
    () =>
      getImageUrl(resolvedBaseUrl, chainId, address, {
        width: w * 2,
        height: h * 2,
        format,
      }),
    [resolvedBaseUrl, chainId, address, w, h, format],
  )

  return <GibImage src={src} size={size} width={width} height={height} {...rest} />
}
