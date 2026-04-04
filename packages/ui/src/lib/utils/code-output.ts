/**
 * @module code-output
 * CSS and URL generation for the Studio code output panel.
 * Extracted from CodeOutput.tsx to enable testing without React rendering.
 */
import type { StudioAppearance } from '../types'

export function shadowToCSS(shadow: StudioAppearance['shadow']): string {
  switch (shadow) {
    case 'subtle':
      return '0 1px 3px rgba(0,0,0,0.12)'
    case 'medium':
      return '0 4px 12px rgba(0,0,0,0.15)'
    case 'strong':
      return '0 8px 24px rgba(0,0,0,0.2)'
    default:
      return ''
  }
}

export function shapeToCSS(shape: StudioAppearance['shape'], borderRadius: number): string {
  switch (shape) {
    case 'circle':
      return '50%'
    case 'rounded':
      return `${borderRadius}px`
    case 'square':
      return '0'
  }
}

export function buildImageUrl(
  chainId: string,
  address: string,
  resolutionOrder: string[] | null,
  apiBase: string,
): string {
  if (resolutionOrder && resolutionOrder.length > 0) {
    return `${apiBase}/image/fallback/${resolutionOrder.join(',')}/${chainId}/${address}`
  }
  return `${apiBase}/image/${chainId}/${address}`
}

export function buildNetworkUrl(chainId: string, apiBase: string): string {
  return `${apiBase}/image/${chainId}`
}
