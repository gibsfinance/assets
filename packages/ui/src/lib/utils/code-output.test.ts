import { describe, it, expect } from 'vitest'
import { shadowToCSS, shapeToCSS, buildImageUrl, buildNetworkUrl } from './code-output'

describe('shadowToCSS', () => {
  it('returns subtle shadow', () => {
    expect(shadowToCSS('subtle')).toBe('0 1px 3px rgba(0,0,0,0.12)')
  })

  it('returns medium shadow', () => {
    expect(shadowToCSS('medium')).toBe('0 4px 12px rgba(0,0,0,0.15)')
  })

  it('returns strong shadow', () => {
    expect(shadowToCSS('strong')).toBe('0 8px 24px rgba(0,0,0,0.2)')
  })

  it('returns empty string for none', () => {
    expect(shadowToCSS('none')).toBe('')
  })
})

describe('shapeToCSS', () => {
  it('returns 50% for circle', () => {
    expect(shapeToCSS('circle', 8)).toBe('50%')
  })

  it('returns px value for rounded', () => {
    expect(shapeToCSS('rounded', 12)).toBe('12px')
    expect(shapeToCSS('rounded', 0)).toBe('0px')
  })

  it('returns 0 for square', () => {
    expect(shapeToCSS('square', 8)).toBe('0')
  })
})

describe('buildImageUrl', () => {
  const base = 'https://gib.show'

  it('builds simple image URL without resolution order', () => {
    expect(buildImageUrl('1', '0xabc', null, base)).toBe('https://gib.show/image/1/0xabc')
  })

  it('builds simple image URL with empty resolution order', () => {
    expect(buildImageUrl('1', '0xabc', [], base)).toBe('https://gib.show/image/1/0xabc')
  })

  it('builds fallback URL with resolution order', () => {
    expect(buildImageUrl('1', '0xabc', ['pulsex', 'coingecko'], base)).toBe(
      'https://gib.show/image/fallback/pulsex,coingecko/1/0xabc',
    )
  })

  it('builds fallback URL with single provider', () => {
    expect(buildImageUrl('369', '0xdef', ['pulsex'], base)).toBe(
      'https://gib.show/image/fallback/pulsex/369/0xdef',
    )
  })
})

describe('buildNetworkUrl', () => {
  it('builds network icon URL', () => {
    expect(buildNetworkUrl('1', 'https://gib.show')).toBe('https://gib.show/image/1')
    expect(buildNetworkUrl('369', 'https://gib.show')).toBe('https://gib.show/image/369')
  })
})
