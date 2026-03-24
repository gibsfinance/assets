import { describe, it, expect } from 'vitest'
import { getImageUrl, getNetworkImageUrl, getThumbnailUrl } from './image'

describe('getImageUrl', () => {
  const base = 'https://gib.show'

  it('builds basic token image URL', () => {
    expect(getImageUrl(base, 1, '0xabc')).toBe('https://gib.show/image/1/0xabc')
  })

  it('adds resize params', () => {
    const url = getImageUrl(base, 1, '0xabc', { width: 72, height: 72 })
    expect(url).toContain('w=72')
    expect(url).toContain('h=72')
  })

  it('adds format param', () => {
    const url = getImageUrl(base, 1, '0xabc', { format: 'webp' })
    expect(url).toContain('format=webp')
  })

  it('combines all params', () => {
    const url = getImageUrl(base, 1, '0xabc', { width: 64, height: 64, format: 'webp', providerKey: 'trustwallet' })
    expect(url).toContain('w=64')
    expect(url).toContain('h=64')
    expect(url).toContain('format=webp')
    expect(url).toContain('providerKey=trustwallet')
  })

  it('returns clean URL with no options', () => {
    expect(getImageUrl(base, 369, '0xdef')).toBe('https://gib.show/image/369/0xdef')
  })

  it('adds listKey param', () => {
    const url = getImageUrl(base, 1, '0xabc', { listKey: 'uniswap-default' })
    expect(url).toContain('listKey=uniswap-default')
  })

  it('returns URL with no query string when options is empty object', () => {
    const url = getImageUrl(base, 1, '0xabc', {})
    expect(url).toBe('https://gib.show/image/1/0xabc')
  })
})

describe('getNetworkImageUrl', () => {
  it('builds network image URL', () => {
    expect(getNetworkImageUrl('https://gib.show', 1)).toBe('https://gib.show/image/1')
  })

  it('adds resize params', () => {
    const url = getNetworkImageUrl('https://gib.show', 1, { width: 48 })
    expect(url).toContain('w=48')
  })
})

describe('getThumbnailUrl', () => {
  it('builds 2x retina WebP URL', () => {
    const url = getThumbnailUrl('https://gib.show', 1, '0xabc', 32)
    expect(url).toContain('w=64')
    expect(url).toContain('h=64')
    expect(url).toContain('format=webp')
  })
})
