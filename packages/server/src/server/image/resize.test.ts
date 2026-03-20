import { describe, it, expect, vi } from 'vitest'

// Mock heavy transitive dependencies so vitest never resolves them
vi.mock('../../db', () => ({}))
vi.mock('../../../config', () => ({ default: {} }))
vi.mock('../../db/tables', () => ({ imageMode: { LINK: 'LINK' } }))
vi.mock('sharp', () => ({ default: vi.fn() }))

import { parseResizeParams, svgHasViewBox, checkRateLimit, extToFormat, formatToContentType } from './resize'

describe('parseResizeParams', () => {
  it('returns null when no resize params', () => {
    expect(parseResizeParams({})).toBeNull()
    expect(parseResizeParams({ providerKey: 'test' })).toBeNull()
  })

  it('parses w only', () => {
    expect(parseResizeParams({ w: '72' })).toEqual({ w: 72, h: null, format: null })
  })

  it('parses h only', () => {
    expect(parseResizeParams({ h: '64' })).toEqual({ w: null, h: 64, format: null })
  })

  it('parses w + h + format', () => {
    expect(parseResizeParams({ w: '72', h: '72', format: 'webp' })).toEqual({ w: 72, h: 72, format: 'webp' })
  })

  it('normalizes jpeg to jpg', () => {
    expect(parseResizeParams({ format: 'jpeg' })).toEqual({ w: null, h: null, format: 'jpg' })
  })

  it('rejects invalid dimensions', () => {
    expect(parseResizeParams({ w: '0' })).toBeNull()
    expect(parseResizeParams({ w: '-1' })).toBeNull()
    expect(parseResizeParams({ w: '9999' })).toBeNull()
    expect(parseResizeParams({ w: 'abc' })).toBeNull()
  })

  it('rejects invalid formats', () => {
    expect(parseResizeParams({ format: 'bmp' })).toBeNull()
    expect(parseResizeParams({ format: 'tiff' })).toBeNull()
  })

  it('parses format only', () => {
    expect(parseResizeParams({ format: 'webp' })).toEqual({ w: null, h: null, format: 'webp' })
  })

  it('accepts boundary dimensions', () => {
    expect(parseResizeParams({ w: '1' })).toEqual({ w: 1, h: null, format: null })
    expect(parseResizeParams({ w: '2048' })).toEqual({ w: 2048, h: null, format: null })
    expect(parseResizeParams({ w: '2049' })).toBeNull()
  })
})

describe('svgHasViewBox', () => {
  it('detects viewBox attribute', () => {
    expect(svgHasViewBox(Buffer.from('<svg viewBox="0 0 24 24"></svg>'))).toBe(true)
    expect(svgHasViewBox(Buffer.from('<svg ViewBox="0 0 24 24"></svg>'))).toBe(true)
    expect(svgHasViewBox(Buffer.from('<svg VIEWBOX="0 0 24 24"></svg>'))).toBe(true)
  })

  it('returns false when no viewBox', () => {
    expect(svgHasViewBox(Buffer.from('<svg width="24" height="24"></svg>'))).toBe(false)
  })

  it('handles empty buffer', () => {
    expect(svgHasViewBox(Buffer.from(''))).toBe(false)
  })
})

describe('extToFormat', () => {
  it('maps common extensions to sharp format names', () => {
    expect(extToFormat('.png')).toBe('png')
    expect(extToFormat('.jpg')).toBe('jpeg')
    expect(extToFormat('.jpeg')).toBe('jpeg')
    expect(extToFormat('.webp')).toBe('webp')
    expect(extToFormat('.avif')).toBe('avif')
  })

  it('maps SVG to PNG (rasterization)', () => {
    expect(extToFormat('.svg')).toBe('png')
    expect(extToFormat('.svg+xml')).toBe('png')
  })

  it('defaults unknown formats to PNG', () => {
    expect(extToFormat('.bmp')).toBe('png')
    expect(extToFormat('.tiff')).toBe('png')
  })
})

describe('formatToContentType', () => {
  it('maps formats to content types', () => {
    expect(formatToContentType('webp')).toBe('image/webp')
    expect(formatToContentType('png')).toBe('image/png')
    expect(formatToContentType('jpg')).toBe('image/jpeg')
    expect(formatToContentType('avif')).toBe('image/avif')
  })
})

describe('checkRateLimit', () => {
  it('allows up to 5 inserts per image', () => {
    const hash = 'test-per-image-' + Date.now()
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(hash)).toBe(true)
    }
    expect(checkRateLimit(hash)).toBe(false)
  })

  it('separate images have separate limits', () => {
    const hash1 = 'test-separate-1-' + Date.now()
    const hash2 = 'test-separate-2-' + Date.now()
    for (let i = 0; i < 5; i++) checkRateLimit(hash1)
    expect(checkRateLimit(hash1)).toBe(false)
    expect(checkRateLimit(hash2)).toBe(true) // different image, still has budget
  })
})
