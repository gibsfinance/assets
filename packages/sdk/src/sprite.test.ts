import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getSpriteUrl, getSpriteSheetUrl, fetchSprite } from './sprite'

const BASE = 'https://gib.show'

/** Golden sprite keys shared with the server — see fixtures/sprite-key-contract.json */
const spriteKeyContract = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../fixtures/sprite-key-contract.json', import.meta.url)), 'utf8'),
) as {
  entries: { note: string; chainId: string; address: string; key: string }[]
  lookups: { note: string; chainId: number | string; address: string; key: string }[]
}

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

  it('passes a namespaced chainId through — the only form that can name Solana', () => {
    // The option was typed `number`, so this was previously unexpressible: a bare
    // 501 means eip155-501, a different chain that happens to share the number.
    const url = getSpriteUrl(BASE, 'jupiter', 'tag-meme', { chainId: 'solana-501' })
    expect(url).toContain('chainId=solana-501')
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
    // Keyed the way the server actually keys sprites: the full CAIP-2 identifier
    // ahead of the address. The previous fixture used a bare `1-0xabc`, a shape no
    // deployment has served since chain ids became CAIP-2 — so these tests passed
    // while every real lookup returned null.
    tokens: {
      'eip155-1-0xabc': [0, 0] as [number, number],
      'eip155-1-0xdef': [1, 0] as [number, number],
      'eip155-1-0x123': [2, 0] as [number, number],
      'eip155-1-0x456': 'data:image/svg+xml;base64,PHN2Zz4=',
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
    expect(sprite.keys()).toContain('eip155-1-0xabc')
    expect(sprite.keys()).toContain('eip155-1-0x456')
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
        'eip155-1-0xrow2': [3, 1] as [number, number],
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
        'eip155-1-0xrow2': [3, 1] as [number, number],
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
        'eip155-1-0xabc': [0, 0] as [number, number],
        'eip155-137-0xabc': [1, 0] as [number, number],
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

  it('indexes a separator-less manifest key without disturbing its neighbours', async () => {
    // Case-folding splits on the last '-' so that only the address half is folded.
    // A key carrying no separator has no address half, and without the guard the
    // whole key would be taken as the address — folding a value the server may
    // well intend as case-significant, the same class of corruption the base58
    // handling above exists to prevent. No lookup can reach such a key either
    // way, since every lookup key is built with a chain prefix, so the guarantee
    // under test is the narrower one: a malformed entry is carried through as
    // served and does not derail the rest of the index.
    const oddManifest = {
      ...mockManifest,
      count: 2,
      rasterCount: 2,
      svgCount: 0,
      tokens: {
        NATIVE: [0, 0] as [number, number],
        'eip155-1-0xABC': [1, 0] as [number, number],
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(oddManifest),
    }))
    const sprite = await fetchSprite(BASE, 'coingecko', 'ethereum')
    expect(sprite.keys()).toContain('NATIVE')
    // The well-formed neighbour still folds, so either casing resolves it.
    expect(sprite.has(1, '0xABC')).toBe(true)
    expect(sprite.has(1, '0xabc')).toBe(true)
  })
})

/**
 * The consuming half of the sprite contract.
 *
 * The server cannot import this module and this module cannot import the server,
 * so `fixtures/sprite-key-contract.json` is the only thing pairing them. Its keys
 * were captured from live manifests. Before this suite existed, `tokenKey` built
 * `1-0x…` while every manifest carried `eip155-1-0x…`, and the lookup methods
 * declared `chainId: number` — so the only value the signature allowed was the one
 * that never matched. The tests above stayed green because their fixture manifest
 * was written in that same bare-number shape: both halves agreed with each other
 * and neither agreed with the server. Asserting against captured keys is what
 * makes that failure mode impossible to repeat.
 */
describe('sprite key contract (shared fixture)', () => {
  /** A manifest carrying every golden key, each at a distinct grid position. */
  function contractManifest() {
    const tokens: Record<string, [number, number]> = {}
    spriteKeyContract.entries.forEach((entry, index) => {
      tokens[entry.key] = [index, 0]
    })
    return {
      spriteUrl: '/sprite/p/l/sheet?size=32&cols=25',
      size: 32,
      cols: 25,
      rows: 1,
      rasterCount: spriteKeyContract.entries.length,
      svgCount: 0,
      count: spriteKeyContract.entries.length,
      tokens,
    }
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(contractManifest()) }),
    )
  })

  for (const entry of spriteKeyContract.entries) {
    it(`resolves ${entry.key} — ${entry.note}`, async () => {
      const sprite = await fetchSprite(BASE, 'p', 'l')
      expect(sprite.has(entry.chainId, entry.address)).toBe(true)
      expect(sprite.getIcon(entry.chainId, entry.address)).not.toBeNull()
    })
  }

  for (const lookup of spriteKeyContract.lookups) {
    it(`accepts chainId ${JSON.stringify(lookup.chainId)} for ${lookup.key} — ${lookup.note}`, async () => {
      const sprite = await fetchSprite(BASE, 'p', 'l')
      expect(sprite.has(lookup.chainId, lookup.address)).toBe(true)

      // Resolves the SAME cell the canonical key resolves — not merely "something".
      const target = spriteKeyContract.entries.find((entry) => entry.key === lookup.key)!
      expect(sprite.getIcon(lookup.chainId, lookup.address)).toEqual(
        sprite.getIcon(target.chainId, target.address),
      )
    })
  }

  it('hands back the server keys verbatim, leaving base58 ids uncorrupted', async () => {
    const sprite = await fetchSprite(BASE, 'p', 'l')
    // A blanket toLowerCase() over the manifest — what this module used to do —
    // both collides distinct Solana mints and returns callers a broken address.
    expect(sprite.keys()).toContain('solana-501-GozPNCAseytzxCR3d2k8hTsTYkr4SDpuXy2RQAZFVx2g')
    expect(sprite.keys()).toContain('tvm-195-TB6SgnNZyqz2KnFRw6yQM7AqVSCphfvBXy')
    expect(sprite.keys()).toEqual(spriteKeyContract.entries.map((entry) => entry.key))
  })

  it('keeps base58 case significant — a lowercased mint is a different token', async () => {
    const sprite = await fetchSprite(BASE, 'p', 'l')
    const mint = 'GozPNCAseytzxCR3d2k8hTsTYkr4SDpuXy2RQAZFVx2g'
    expect(sprite.has('solana-501', mint)).toBe(true)
    expect(sprite.has('solana-501', mint.toLowerCase())).toBe(false)
  })

  it('does not confuse solana-501 with eip155-501, which is a different chain', async () => {
    const sprite = await fetchSprite(BASE, 'p', 'l')
    const mint = 'GozPNCAseytzxCR3d2k8hTsTYkr4SDpuXy2RQAZFVx2g'
    expect(sprite.has('eip155-501', mint)).toBe(false)
    // A bare 501 assumes eip155 — it cannot reach Solana, which is why the
    // identifier is the form callers should pass.
    expect(sprite.has(501, mint)).toBe(false)
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
