import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { GibProvider } from './provider'
import { TokenImage } from './token-image'

function getImg(container: HTMLElement) {
  const img = container.querySelector('img')
  if (!img) throw new Error('img not found')
  return img
}

describe('TokenImage', () => {
  const address = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'

  it('renders an img with correct src inside GibProvider', () => {
    const { container } = render(
      <GibProvider>
        <TokenImage chainId={1} address={address} size={32} />
      </GibProvider>,
    )
    expect(getImg(container).getAttribute('src')).toBe(`https://gib.show/image/1/${address}?w=64&h=64&as=webp`)
  })

  it('renders with 2x dimensions for Retina', () => {
    const { container } = render(
      <GibProvider>
        <TokenImage chainId={1} address={address} size={48} />
      </GibProvider>,
    )
    const src = getImg(container).getAttribute('src') ?? ''
    expect(src).toContain('w=96')
    expect(src).toContain('h=96')
  })

  // `as`, not `format` — the server ignores `format` and serves the stored
  // original, so this component's whole reason for defaulting to WebP was moot.
  it('respects custom format, using the param the server reads', () => {
    const { container } = render(
      <GibProvider>
        <TokenImage chainId={1} address={address} format="png" />
      </GibProvider>,
    )
    const src = getImg(container).getAttribute('src') ?? ''
    expect(src).toContain('as=png')
    expect(src).not.toContain('format=png')
  })

  // Solana addresses are base58 and its chain number, 501, is also Columbus
  // testnet's. Only the namespaced identifier reaches the right image.
  it('accepts a namespaced chain identifier', () => {
    const solana = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const { container } = render(<TokenImage chainId="solana-501" address={solana} size={32} />)
    expect(getImg(container).getAttribute('src')).toBe(
      `https://gib.show/image/solana-501/${solana}?w=64&h=64&as=webp`,
    )
  })

  it('uses baseUrl override when provided', () => {
    const { container } = render(
      <GibProvider>
        <TokenImage chainId={42161} address={address} baseUrl="https://custom.api" />
      </GibProvider>,
    )
    expect(getImg(container).getAttribute('src')).toContain('https://custom.api/image/42161/')
  })

  it('falls back to production URL without GibProvider', () => {
    const { container } = render(<TokenImage chainId={1} address={address} />)
    expect(getImg(container).getAttribute('src')).toContain('https://gib.show/image/1/')
  })

  it('renders with correct display dimensions', () => {
    const { container } = render(
      <GibProvider>
        <TokenImage chainId={1} address={address} size={24} />
      </GibProvider>,
    )
    const img = getImg(container)
    expect(img.getAttribute('width')).toBe('24')
    expect(img.getAttribute('height')).toBe('24')
  })
})
