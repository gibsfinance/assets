import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { GibProvider } from './provider'
import { NetworkImage } from './network-image'

function getImg(container: HTMLElement) {
  const img = container.querySelector('img')
  if (!img) throw new Error('img not found')
  return img
}

describe('NetworkImage', () => {
  it('renders with correct network image URL', () => {
    const { container } = render(
      <GibProvider>
        <NetworkImage chainId={1} size={24} />
      </GibProvider>,
    )
    expect(getImg(container).getAttribute('src')).toBe(
      'https://gib.show/image/1?w=48&h=48&format=webp',
    )
  })

  it('uses staging URL when GibProvider is staging', () => {
    const { container } = render(
      <GibProvider staging>
        <NetworkImage chainId={137} />
      </GibProvider>,
    )
    expect(getImg(container).getAttribute('src')).toContain('https://staging.gib.show/image/137')
  })

  it('uses baseUrl override', () => {
    const { container } = render(
      <GibProvider>
        <NetworkImage chainId={10} baseUrl="https://my-api.com" />
      </GibProvider>,
    )
    expect(getImg(container).getAttribute('src')).toContain('https://my-api.com/image/10')
  })

  it('defaults to size=24 with 2x for Retina', () => {
    const { container } = render(
      <GibProvider>
        <NetworkImage chainId={1} />
      </GibProvider>,
    )
    const img = getImg(container)
    const src = img.getAttribute('src') ?? ''
    expect(src).toContain('w=48')
    expect(src).toContain('h=48')
    expect(img.getAttribute('width')).toBe('24')
    expect(img.getAttribute('height')).toBe('24')
  })

  it('falls back to production URL without GibProvider', () => {
    const { container } = render(<NetworkImage chainId={56} />)
    expect(getImg(container).getAttribute('src')).toContain('https://gib.show/image/56')
  })
})
