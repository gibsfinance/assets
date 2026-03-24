import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createClient } from './client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchOk(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response)
}

function makeFetchError(status: number): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: vi.fn(),
  } as unknown as Response)
}

// ---------------------------------------------------------------------------
// URL-building tests (existing)
// ---------------------------------------------------------------------------

describe('createClient', () => {
  it('defaults to production URL', () => {
    const client = createClient()
    expect(client.baseUrl).toBe('https://gib.show')
  })

  it('uses staging URL when staging: true', () => {
    const client = createClient({ staging: true })
    expect(client.baseUrl).toBe('https://staging.gib.show')
  })

  it('uses custom baseUrl', () => {
    const client = createClient({ baseUrl: 'http://localhost:3000' })
    expect(client.baseUrl).toBe('http://localhost:3000')
  })

  it('builds image URLs via client', () => {
    const client = createClient()
    const url = client.imageUrl(1, '0xabc', { width: 72, format: 'webp' })
    expect(url).toContain('https://gib.show/image/1/0xabc')
    expect(url).toContain('w=72')
    expect(url).toContain('format=webp')
  })

  it('builds network image URLs via client', () => {
    const client = createClient({ staging: true })
    expect(client.networkImageUrl(369)).toBe('https://staging.gib.show/image/369')
  })
})

// ---------------------------------------------------------------------------
// spriteUrl()
// ---------------------------------------------------------------------------

describe('client.spriteUrl', () => {
  it('returns the correct URL without options', () => {
    const client = createClient()
    expect(client.spriteUrl('uniswap', 'default')).toBe(
      'https://gib.show/sprite/uniswap/default',
    )
  })

  it('appends query params when options are supplied', () => {
    const client = createClient()
    const url = client.spriteUrl('uniswap', 'default', { size: 64, cols: 10, chainId: 1 })
    expect(url).toContain('size=64')
    expect(url).toContain('cols=10')
    expect(url).toContain('chainId=1')
  })

  it('respects custom baseUrl', () => {
    const client = createClient({ baseUrl: 'http://localhost:3000' })
    expect(client.spriteUrl('my', 'list')).toBe(
      'http://localhost:3000/sprite/my/list',
    )
  })
})

// ---------------------------------------------------------------------------
// fetchTokenList
// ---------------------------------------------------------------------------

describe('client.fetchTokenList', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  const tokenListFixture = {
    name: 'Test List',
    timestamp: '2024-01-01T00:00:00Z',
    version: { major: 1, minor: 0, patch: 0 },
    tokens: [
      {
        chainId: 1,
        address: '0xabc',
        name: 'Token A',
        symbol: 'TKA',
        decimals: 18,
      },
    ],
  }

  it('fetches the correct URL and returns parsed JSON on success', async () => {
    const mockFetch = makeFetchOk(tokenListFixture)
    vi.stubGlobal('fetch', mockFetch)

    const client = createClient()
    const result = await client.fetchTokenList('uniswap', 'default')

    expect(mockFetch).toHaveBeenCalledWith('https://gib.show/list/uniswap/default')
    expect(result).toEqual(tokenListFixture)
  })

  it('appends chainId query param when provided', async () => {
    const mockFetch = makeFetchOk(tokenListFixture)
    vi.stubGlobal('fetch', mockFetch)

    const client = createClient()
    await client.fetchTokenList('uniswap', 'default', 1)

    expect(mockFetch).toHaveBeenCalledWith('https://gib.show/list/uniswap/default?chainId=1')
  })

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', makeFetchError(404))

    const client = createClient()
    await expect(client.fetchTokenList('uniswap', 'default')).rejects.toThrow(
      'Failed to fetch list: 404',
    )
  })
})

// ---------------------------------------------------------------------------
// fetchNetworks
// ---------------------------------------------------------------------------

describe('client.fetchNetworks', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  const networksFixture = [
    { networkId: 'ethereum', type: 'evm', chainId: '1', imageHash: 'abc123' },
    { networkId: 'polygon', type: 'evm', chainId: '137', imageHash: null },
  ]

  it('fetches the correct URL and returns parsed JSON on success', async () => {
    const mockFetch = makeFetchOk(networksFixture)
    vi.stubGlobal('fetch', mockFetch)

    const client = createClient()
    const result = await client.fetchNetworks()

    expect(mockFetch).toHaveBeenCalledWith('https://gib.show/networks')
    expect(result).toEqual(networksFixture)
  })

  it('uses staging URL when client is in staging mode', async () => {
    const mockFetch = makeFetchOk(networksFixture)
    vi.stubGlobal('fetch', mockFetch)

    const client = createClient({ staging: true })
    await client.fetchNetworks()

    expect(mockFetch).toHaveBeenCalledWith('https://staging.gib.show/networks')
  })

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', makeFetchError(500))

    const client = createClient()
    await expect(client.fetchNetworks()).rejects.toThrow('Failed to fetch networks: 500')
  })
})

// ---------------------------------------------------------------------------
// fetchLists
// ---------------------------------------------------------------------------

describe('client.fetchLists', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  const listsFixture = [
    {
      key: 'default',
      name: 'Default List',
      providerKey: 'uniswap',
      chainId: '1',
      chainType: 'evm',
      default: true,
      major: 1,
      minor: 0,
      patch: 0,
    },
  ]

  it('fetches the correct URL and returns parsed JSON on success', async () => {
    const mockFetch = makeFetchOk(listsFixture)
    vi.stubGlobal('fetch', mockFetch)

    const client = createClient()
    const result = await client.fetchLists()

    expect(mockFetch).toHaveBeenCalledWith('https://gib.show/list')
    expect(result).toEqual(listsFixture)
  })

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', makeFetchError(503))

    const client = createClient()
    await expect(client.fetchLists()).rejects.toThrow('Failed to fetch lists: 503')
  })
})

// ---------------------------------------------------------------------------
// fetchSprite
// ---------------------------------------------------------------------------

describe('client.fetchSprite', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  const spriteManifestFixture = {
    spriteUrl: '/sprite/uniswap/default/sheet',
    size: 32,
    cols: 25,
    rows: 2,
    rasterCount: 2,
    svgCount: 0,
    count: 2,
    tokens: {
      '1-0xabc': [0, 0],
      '1-0xdef': [1, 0],
    },
  }

  it('fetches the correct URL and returns a Sprite object on success', async () => {
    const mockFetch = makeFetchOk(spriteManifestFixture)
    vi.stubGlobal('fetch', mockFetch)

    const client = createClient()
    const sprite = await client.fetchSprite('uniswap', 'default')

    expect(mockFetch).toHaveBeenCalledWith('https://gib.show/sprite/uniswap/default')
    expect(sprite).toHaveProperty('manifest')
    expect(sprite).toHaveProperty('sheetUrl')
    expect(typeof sprite.getIcon).toBe('function')
    expect(typeof sprite.getBackgroundCSS).toBe('function')
    expect(typeof sprite.has).toBe('function')
    expect(typeof sprite.keys).toBe('function')
  })

  it('resolves sheetUrl from a relative spriteUrl in the manifest', async () => {
    const mockFetch = makeFetchOk(spriteManifestFixture)
    vi.stubGlobal('fetch', mockFetch)

    const client = createClient()
    const sprite = await client.fetchSprite('uniswap', 'default')

    expect(sprite.sheetUrl).toBe('https://gib.show/sprite/uniswap/default/sheet')
  })

  it('getIcon returns a sprite-type icon for a known token', async () => {
    vi.stubGlobal('fetch', makeFetchOk(spriteManifestFixture))

    const client = createClient()
    const sprite = await client.fetchSprite('uniswap', 'default')
    const icon = sprite.getIcon(1, '0xabc')

    expect(icon).toEqual({
      type: 'sprite',
      url: 'https://gib.show/sprite/uniswap/default/sheet',
      x: 0,
      y: 0,
      size: 32,
    })
  })

  it('getIcon returns null for an unknown token', async () => {
    vi.stubGlobal('fetch', makeFetchOk(spriteManifestFixture))

    const client = createClient()
    const sprite = await client.fetchSprite('uniswap', 'default')

    expect(sprite.getIcon(1, '0x000')).toBeNull()
  })

  it('has() returns true for a known token and false for an unknown one', async () => {
    vi.stubGlobal('fetch', makeFetchOk(spriteManifestFixture))

    const client = createClient()
    const sprite = await client.fetchSprite('uniswap', 'default')

    expect(sprite.has(1, '0xabc')).toBe(true)
    expect(sprite.has(1, '0x000')).toBe(false)
  })

  it('keys() returns all token keys', async () => {
    vi.stubGlobal('fetch', makeFetchOk(spriteManifestFixture))

    const client = createClient()
    const sprite = await client.fetchSprite('uniswap', 'default')

    expect(sprite.keys()).toEqual(expect.arrayContaining(['1-0xabc', '1-0xdef']))
  })

  it('passes options as query params to the sprite URL', async () => {
    const mockFetch = makeFetchOk(spriteManifestFixture)
    vi.stubGlobal('fetch', mockFetch)

    const client = createClient()
    await client.fetchSprite('uniswap', 'default', { size: 64, chainId: 1 })

    const calledUrl = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('size=64')
    expect(calledUrl).toContain('chainId=1')
  })

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', makeFetchError(403))

    const client = createClient()
    await expect(client.fetchSprite('uniswap', 'default')).rejects.toThrow(
      'Failed to fetch sprite manifest: 403',
    )
  })
})
