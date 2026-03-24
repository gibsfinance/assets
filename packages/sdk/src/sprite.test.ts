import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSpriteUrl, getSpriteSheetUrl, fetchSprite } from './sprite'

const BASE = 'https://gib.show'

describe('getSpriteUrl', () => {
  it('builds basic sprite manifest URL', () => {
    expect(getSpriteUrl(BASE, 'coingecko', 'ethereum')).toBe(
      'https://gib.show/sprite/coingecko/ethereum',
    )
  })

  it('includes size and cols params', () => {
    const url = getSpriteUrl(BASE, 'coingecko', 'ethereum', { size: 48, cols: 20 })
    expect(url).toContain('size=48')
    expect(url).toContain('cols=20')
  })

  it('includes chainId filter', () => {
    const url = getSpriteUrl(BASE, 'trustwallet', 'hosted', { chainId: 1 })
    expect(url).toContain('chainId=1')
  })

  it('includes content=mixed param', () => {
    const url = getSpriteUrl(BASE, 'coingecko', 'ethereum', { content: 'mixed' })
    expect(url).toContain('content=mixed')
  })
})

describe('getSpriteSheetUrl', () => {
  it('builds sheet URL with /sheet path', () => {
    const url = getSpriteSheetUrl(BASE, 'coingecko', 'ethereum')
    expect(url).toContain('/sprite/coingecko/ethereum/sheet')
  })

  it('includes params', () => {
    const url = getSpriteSheetUrl(BASE, 'pulsex', 'extended', { size: 64, content: 'mixed' })
    expect(url).toContain('/sheet')
    expect(url).toContain('size=64')
    expect(url).toContain('content=mixed')
  })
})

describe('fetchSprite', () => {
  const mockManifest = {
    spriteUrl: '/sprite/coingecko/ethereum/sheet?size=32&cols=25',
    size: 32,
    cols: 25,
    rows: 2,
    rasterCount: 3,
    svgCount: 1,
    count: 4,
    tokens: {
      '1-0xabc': [0, 0] as [number, number],
      '1-0xdef': [1, 0] as [number, number],
      '1-0x123': [2, 0] as [number, number],
      '1-0x456': 'data:image/svg+xml;base64,PHN2Zz4=',
    },
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockManifest),
    }))
  })

  it('fetches and parses the manifest', async () => {
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    expect(sprite.manifest.count).toBe(4)
    expect(sprite.manifest.rasterCount).toBe(3)
    expect(sprite.manifest.svgCount).toBe(1)
  })

  it('resolves full sheet URL', async () => {
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    expect(sprite.sheetUrl).toBe('https://gib.show/sprite/coingecko/ethereum/sheet?size=32&cols=25')
  })

  it('getIcon returns sprite position for rasters', async () => {
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    const icon = sprite.getIcon(1, '0xabc')
    expect(icon).toEqual({ type: 'sprite', url: sprite.sheetUrl, x: 0, y: 0, size: 32 })
  })

  it('getIcon returns correct offset for non-zero position', async () => {
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    const icon = sprite.getIcon(1, '0xdef')
    expect(icon).toEqual({ type: 'sprite', url: sprite.sheetUrl, x: 32, y: 0, size: 32 })
  })

  it('getIcon returns SVG data URI for inline SVGs', async () => {
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    const icon = sprite.getIcon(1, '0x456')
    expect(icon).toEqual({ type: 'svg', dataUri: 'data:image/svg+xml;base64,PHN2Zz4=' })
  })

  it('getIcon returns null for unknown tokens', async () => {
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    expect(sprite.getIcon(1, '0xunknown')).toBeNull()
  })

  it('has() checks token existence', async () => {
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    expect(sprite.has(1, '0xabc')).toBe(true)
    expect(sprite.has(1, '0xunknown')).toBe(false)
  })

  it('getBackgroundCSS returns sprite background for rasters', async () => {
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    const css = sprite.getBackgroundCSS(1, '0xdef')
    expect(css).not.toBeNull()
    expect(css!.backgroundImage).toContain(sprite.sheetUrl)
    expect(css!.backgroundPosition).toBe('-32px 0px')
  })

  it('getBackgroundCSS returns data URI background for SVGs', async () => {
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    const css = sprite.getBackgroundCSS(1, '0x456')
    expect(css).not.toBeNull()
    expect(css!.backgroundImage).toContain('data:image/svg+xml')
    expect(css!.backgroundSize).toBe('contain')
  })

  it('getBackgroundCSS returns null for unknown tokens', async () => {
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    expect(sprite.getBackgroundCSS(1, '0xunknown')).toBeNull()
  })

  it('keys() returns all token keys', async () => {
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    expect(sprite.keys()).toHaveLength(4)
    expect(sprite.keys()).toContain('1-0xabc')
    expect(sprite.keys()).toContain('1-0x456')
  })

  it('is case-insensitive for addresses', async () => {
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    expect(sprite.has(1, '0xABC')).toBe(true)
    expect(sprite.getIcon(1, '0xABC')).not.toBeNull()
  })

  it('throws on failed fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(fetchSprite(BASE, 'coingecko', 'nonexistent')).rejects.toThrow('404')
  })

  it('resolves absolute spriteUrl without prepending baseUrl', async () => {
    const absManifest = {
      ...mockManifest,
      spriteUrl: 'https://cdn.example.com/sprites/sheet.png',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(absManifest),
    }))
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    expect(sprite.sheetUrl).toBe('https://cdn.example.com/sprites/sheet.png')
  })

  it('getBackgroundCSS uses 0px for position [0,0]', async () => {
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    const css = sprite.getBackgroundCSS(1, '0xabc')
    expect(css).not.toBeNull()
    expect(css!.backgroundPosition).toBe('0px 0px')
  })

  it('getBackgroundCSS computes backgroundSize from cols * size', async () => {
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    const css = sprite.getBackgroundCSS(1, '0xabc')
    // cols=25, size=32 => 800px auto
    expect(css!.backgroundSize).toBe('800px auto')
  })

  it('getBackgroundCSS includes backgroundRepeat: no-repeat for rasters', async () => {
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    const css = sprite.getBackgroundCSS(1, '0xabc')
    expect(css!.backgroundRepeat).toBe('no-repeat')
  })

  it('getBackgroundCSS includes backgroundRepeat: no-repeat for SVGs', async () => {
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    const css = sprite.getBackgroundCSS(1, '0x456')
    expect(css!.backgroundRepeat).toBe('no-repeat')
  })

  it('getBackgroundCSS uses negative px offsets for token in row 2 (y > 0)', async () => {
    const multiRowManifest = {
      ...mockManifest,
      tokens: {
        ...mockManifest.tokens,
        '1-0xrow2': [3, 1] as [number, number],
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(multiRowManifest),
    }))
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    const css = sprite.getBackgroundCSS(1, '0xrow2')
    expect(css).not.toBeNull()
    // col=3, row=1, size=32 => x=96, y=32 — both use negative px form
    expect(css!.backgroundPosition).toBe('-96px -32px')
  })

  it('getIcon computes y offset for multi-row positions', async () => {
    const multiRowManifest = {
      ...mockManifest,
      tokens: {
        ...mockManifest.tokens,
        '1-0xrow2': [3, 1] as [number, number],
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(multiRowManifest),
    }))
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    const icon = sprite.getIcon(1, '0xrow2')
    expect(icon).toEqual({
      type: 'sprite',
      url: sprite.sheetUrl,
      x: 3 * 32, // col 3 * 32px
      y: 1 * 32, // row 1 * 32px
      size: 32,
    })
  })

  it('handles different chain IDs in token lookup', async () => {
    const multiChainManifest = {
      ...mockManifest,
      tokens: {
        '1-0xabc': [0, 0] as [number, number],
        '137-0xabc': [1, 0] as [number, number],
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(multiChainManifest),
    }))
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    expect(sprite.has(1, '0xabc')).toBe(true)
    expect(sprite.has(137, '0xabc')).toBe(true)
    expect(sprite.has(56, '0xabc')).toBe(false)

    const icon1 = sprite.getIcon(1, '0xabc')
    const icon137 = sprite.getIcon(137, '0xabc')
    expect(icon1).not.toEqual(icon137)
  })

  it('returns empty keys for manifest with no tokens', async () => {
    const emptyManifest = {
      ...mockManifest,
      count: 0,
      rasterCount: 0,
      svgCount: 0,
      tokens: {},
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(emptyManifest),
    }))
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    expect(sprite.keys()).toHaveLength(0)
    expect(sprite.has(1, '0xanything')).toBe(false)
    expect(sprite.getIcon(1, '0xanything')).toBeNull()
  })
})

describe('getSpriteUrl — additional edge cases', () => {
  it('includes limit param', () => {
    const url = getSpriteUrl(BASE, 'coingecko', 'ethereum', { limit: 100 })
    expect(url).toContain('limit=100')
  })

  it('omits params when options is undefined', () => {
    const url = getSpriteUrl(BASE, 'coingecko', 'ethereum')
    expect(url).not.toContain('?')
  })

  it('omits params when all options are undefined', () => {
    const url = getSpriteUrl(BASE, 'coingecko', 'ethereum', {})
    expect(url).not.toContain('?')
  })

  it('combines multiple params', () => {
    const url = getSpriteUrl(BASE, 'coingecko', 'ethereum', {
      size: 64,
      cols: 10,
      limit: 200,
      chainId: 1,
      content: 'mixed',
    })
    expect(url).toContain('size=64')
    expect(url).toContain('cols=10')
    expect(url).toContain('limit=200')
    expect(url).toContain('chainId=1')
    expect(url).toContain('content=mixed')
  })
})

describe('getSpriteSheetUrl — additional edge cases', () => {
  it('produces correct URL structure with /sheet inserted', () => {
    const url = getSpriteSheetUrl(BASE, 'provider', 'list-name')
    expect(url).toBe('https://gib.show/sprite/provider/list-name/sheet')
  })

  it('preserves query params when inserting /sheet', () => {
    const url = getSpriteSheetUrl(BASE, 'provider', 'list-name', { size: 48 })
    expect(url).toContain('/sprite/provider/list-name/sheet')
    expect(url).toContain('size=48')
  })
})
