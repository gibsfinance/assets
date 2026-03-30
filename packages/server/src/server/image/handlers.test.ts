import { describe, it, expect, vi } from 'vitest'

// Mock heavy transitive dependencies before importing handlers
vi.mock('../../db/tables', () => ({
  imageMode: { SAVE: 'save', LINK: 'link' },
}))
vi.mock('../../db', () => ({}))
vi.mock('../../db/drizzle', () => ({ getDrizzle: vi.fn() }))
vi.mock('../../db/schema', () => ({}))
vi.mock('../../db/sync-order', () => ({ getDefaultListOrderId: vi.fn() }))
vi.mock('../../utils', () => ({ chainIdToNetworkId: vi.fn() }))
vi.mock('../../paths', () => ({ submodules: '' }))
vi.mock('../../types', () => ({}))
vi.mock('../../../config', () => ({ default: { cacheSeconds: 86400 } }))
vi.mock('./resize', () => ({ maybeResize: vi.fn() }))
vi.mock('sharp', () => ({ default: vi.fn() }))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
  sql: Object.assign(vi.fn(), { join: vi.fn(), raw: vi.fn() }),
}))

import { parseFormatPreference, formatToExts, splitExt, extFilter } from './handlers'

// ---------------------------------------------------------------------------
// parseFormatPreference
// ---------------------------------------------------------------------------

describe('parseFormatPreference', () => {
  it('returns empty array for undefined', () => {
    expect(parseFormatPreference(undefined)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseFormatPreference('')).toEqual([])
  })

  it('parses a single format name', () => {
    expect(parseFormatPreference('webp')).toEqual([['.webp']])
  })

  it('parses comma-separated format names', () => {
    expect(parseFormatPreference('vector,webp,png,jpg')).toEqual([
      ['.svg', '.svg+xml', '.xml'],
      ['.webp'],
      ['.png'],
      ['.jpg', '.jpeg'],
    ])
  })

  it('handles repeated query keys (Express array form)', () => {
    // Express parses ?format=vector&format=webp as ['vector', 'webp']
    expect(parseFormatPreference(['vector', 'webp', 'png'])).toEqual([
      ['.svg', '.svg+xml', '.xml'],
      ['.webp'],
      ['.png'],
    ])
  })

  it('produces same result for comma vs repeated keys', () => {
    const fromComma = parseFormatPreference('vector,webp,png,jpg')
    const fromArray = parseFormatPreference(['vector', 'webp', 'png', 'jpg'])
    expect(fromComma).toEqual(fromArray)
  })

  it('deduplicates format names', () => {
    expect(parseFormatPreference('png,png,webp')).toEqual([['.png'], ['.webp']])
  })

  it('is case-insensitive', () => {
    expect(parseFormatPreference('PNG,WebP')).toEqual([['.png'], ['.webp']])
  })

  it('skips unknown format names', () => {
    expect(parseFormatPreference('vector,bmp,png')).toEqual([['.svg', '.svg+xml', '.xml'], ['.png']])
  })

  it('returns empty array when all names are unknown', () => {
    expect(parseFormatPreference('bmp,tiff')).toEqual([])
  })

  it('trims whitespace around names', () => {
    expect(parseFormatPreference(' png , webp ')).toEqual([['.png'], ['.webp']])
  })

  it('handles raster as a group', () => {
    expect(parseFormatPreference('raster')).toEqual([['.png', '.jpg', '.jpeg', '.webp', '.gif']])
  })

  it('treats svg and jpeg as aliases', () => {
    expect(parseFormatPreference('svg')).toEqual([['.svg', '.svg+xml']])
    expect(parseFormatPreference('jpeg')).toEqual([['.jpg', '.jpeg']])
  })
})

// ---------------------------------------------------------------------------
// formatToExts map
// ---------------------------------------------------------------------------

describe('formatToExts', () => {
  it('has entries for all expected format names', () => {
    const expected = ['vector', 'svg', 'webp', 'png', 'jpg', 'jpeg', 'gif', 'raster']
    for (const name of expected) {
      expect(formatToExts.has(name)).toBe(true)
    }
  })

  it('maps vector to svg-family extensions', () => {
    expect(formatToExts.get('vector')).toEqual(['.svg', '.svg+xml', '.xml'])
  })

  it('maps raster to common raster extensions', () => {
    expect(formatToExts.get('raster')).toEqual(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
  })
})

// ---------------------------------------------------------------------------
// splitExt
// ---------------------------------------------------------------------------

describe('splitExt', () => {
  it('returns filename only when no extension', () => {
    expect(splitExt('0xabc123')).toEqual({ filename: '0xabc123' })
  })

  it('splits a concrete extension', () => {
    expect(splitExt('0xabc123.png')).toEqual({
      filename: '0xabc123',
      ext: '.png',
      exts: ['.png'],
    })
  })

  it('expands .raster to all raster extensions', () => {
    const result = splitExt('0xabc123.raster')
    expect(result.filename).toBe('0xabc123')
    expect(result.ext).toBe('.raster')
    expect(result.exts).toEqual(extFilter.get('.raster'))
  })

  it('expands .vector to all vector extensions', () => {
    const result = splitExt('0xabc123.vector')
    expect(result.filename).toBe('0xabc123')
    expect(result.ext).toBe('.vector')
    expect(result.exts).toEqual(extFilter.get('.vector'))
  })
})
