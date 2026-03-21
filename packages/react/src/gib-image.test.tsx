import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import GibImage from './gib-image'

function getImg(container: HTMLElement) {
  const img = container.querySelector('img')
  if (!img) throw new Error('img not found')
  return img
}

describe('GibImage', () => {
  const src = 'https://gib.show/image/1/0xabc'

  it('renders an img with the provided src', () => {
    const { container } = render(<GibImage src={src} lazy={false} />)
    expect(getImg(container).getAttribute('src')).toBe(src)
  })

  it('defaults to size=32', () => {
    const { container } = render(<GibImage src={src} lazy={false} />)
    const img = getImg(container)
    expect(img.getAttribute('width')).toBe('32')
    expect(img.getAttribute('height')).toBe('32')
  })

  it('respects custom size', () => {
    const { container } = render(<GibImage src={src} size={64} lazy={false} />)
    const img = getImg(container)
    expect(img.getAttribute('width')).toBe('64')
    expect(img.getAttribute('height')).toBe('64')
  })

  it('respects separate width and height', () => {
    const { container } = render(<GibImage src={src} width={100} height={50} lazy={false} />)
    const img = getImg(container)
    expect(img.getAttribute('width')).toBe('100')
    expect(img.getAttribute('height')).toBe('50')
  })

  it('renders skeleton placeholder by default', () => {
    const { container } = render(<GibImage src={src} lazy={false} />)
    const spans = container.querySelectorAll('span')
    // Outer container + skeleton = at least 2 spans
    expect(spans.length).toBeGreaterThanOrEqual(2)
  })

  it('hides skeleton when skeleton=false', () => {
    const { container } = render(<GibImage src={src} skeleton={false} lazy={false} />)
    const spans = container.querySelectorAll('span')
    expect(spans.length).toBe(1) // Only outer container
  })

  it('sets img as non-draggable', () => {
    const { container } = render(<GibImage src={src} lazy={false} />)
    expect(getImg(container).getAttribute('draggable')).toBe('false')
  })

  it('sets async decoding', () => {
    const { container } = render(<GibImage src={src} lazy={false} />)
    expect(getImg(container).getAttribute('decoding')).toBe('async')
  })

  it('applies circle border radius by default', () => {
    const { container } = render(<GibImage src={src} lazy={false} />)
    expect(getImg(container).style.borderRadius).toBe('50%')
  })

  it('applies rect border radius when shape=rect', () => {
    const { container } = render(<GibImage src={src} shape="rect" lazy={false} />)
    expect(getImg(container).style.borderRadius).toBe('4px')
  })

  it('starts with opacity 0 (before load)', () => {
    const { container } = render(<GibImage src={src} lazy={false} />)
    expect(getImg(container).style.opacity).toBe('0')
  })

  it('renders img when lazy (IntersectionObserver fires immediately in tests)', () => {
    const { container } = render(<GibImage src={src} lazy />)
    // Mock IntersectionObserver fires immediately, so img renders
    expect(container.querySelector('img')).not.toBeNull()
  })

  it('passes alt text to the img', () => {
    const { container } = render(<GibImage src={src} alt="WBTC" lazy={false} />)
    expect(getImg(container).getAttribute('alt')).toBe('WBTC')
  })
})
