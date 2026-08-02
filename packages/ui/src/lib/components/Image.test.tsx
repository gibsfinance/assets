import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { createElement } from 'react'

vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof import('../utils')>('../utils')
  return {
    ...actual,
    getApiUrl: (path: string) => `https://api.test${path}`,
  }
})

import Image from './Image'

const srcOf = (container: HTMLElement) => container.querySelector('img')!.getAttribute('src')

afterEach(cleanup)

describe('Image', () => {
  // Nothing in the interface asked the image endpoint for a smaller asset, so a
  // 24-pixel row icon downloaded the full stored logo — tens of kilobytes each,
  // hundreds of times over a scrolling list.
  it('requests our own images at the size it renders them', () => {
    const { container } = render(createElement(Image, { src: 'https://api.test/image/eip155-369', size: 24 }))
    expect(srcOf(container)).toBe('https://api.test/image/eip155-369?w=48&h=48&as=webp')
  })

  it('leaves an upstream image URL untouched', () => {
    const upstream = 'https://raw.githubusercontent.com/org/repo/logo.png'
    const { container } = render(createElement(Image, { src: upstream, size: 24 }))
    expect(srcOf(container)).toBe(upstream)
  })

  // The Studio preview can be zoomed past its layout box, so it is the one surface
  // that genuinely needs the stored bytes.
  it('fetches the original when the caller asks for full resolution', () => {
    const { container } = render(
      createElement(Image, { src: 'https://api.test/image/eip155-1', size: 24, fullResolution: true }),
    )
    expect(srcOf(container)).toBe('https://api.test/image/eip155-1')
  })

  it('sizes from explicit width and height when given instead of size', () => {
    const { container } = render(
      createElement(Image, { src: 'https://api.test/image/eip155-1', width: 24, height: 64 }),
    )
    expect(srcOf(container)).toBe('https://api.test/image/eip155-1?w=48&h=128&as=webp')
  })
})
