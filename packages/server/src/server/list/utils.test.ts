import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetTokensUnderListId = vi.fn()
const mockAddBridgeExtensions = vi.fn()
const mockAddHeaderUriExtension = vi.fn()

vi.mock('../../db/tables', () => ({
  imageMode: { SAVE: 'save', LINK: 'link' },
}))
vi.mock('../../db', () => ({
  getTokensUnderListId: (...args: unknown[]) => mockGetTokensUnderListId(...args),
  addBridgeExtensions: (...args: unknown[]) => mockAddBridgeExtensions(...args),
  addHeaderUriExtension: (...args: unknown[]) => mockAddHeaderUriExtension(...args),
}))
vi.mock('../../db/drizzle', () => ({ getDrizzle: vi.fn() }))
vi.mock('../../db/schema', () => ({
  listToken: { listId: 'listToken.listId', listTokenOrderId: 'listToken.listTokenOrderId' },
}))
vi.mock('../../utils', () => ({
  directUri: ({ imageHash, ext }: { imageHash: string; ext: string }) =>
    imageHash && ext ? `/image/direct/${imageHash}${ext}` : undefined,
}))
vi.mock('../../../config', () => ({
  default: { cacheSeconds: 86400, rootURI: 'http://test' },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  asc: vi.fn((...args: unknown[]) => args),
}))

import { normalizeTokens, tokenFilters, minimalList, respondWithList } from './utils'

function makeToken(overrides: Record<string, unknown>) {
  return {
    chainId: '369',
    providedId: '0xaaa',
    decimals: 18,
    symbol: 'TEST',
    name: 'Test Token',
    tokenId: 'tok-1',
    imageHash: 'abc123',
    ext: '.png',
    mode: 'save',
    uri: 'http://example.com/img.png',
    providerKey: 'provider-a',
    listKey: 'list-a',
    ...overrides,
  }
}

describe('normalizeTokens', () => {
  it('preserves input order — first token in input is first in output', () => {
    const tokens = [
      makeToken({ providedId: '0xfirst', name: 'Zebra', symbol: 'ZZZ', providerKey: 'pulsex', listKey: 'extended' }),
      makeToken({ providedId: '0xsecond', name: 'Apple', symbol: 'AAA', providerKey: 'dexscreener', listKey: 'api' }),
      makeToken({
        providedId: '0xthird',
        name: 'Middle',
        symbol: 'MMM',
        providerKey: 'coingecko',
        listKey: 'ethereum',
      }),
    ]

    const result = normalizeTokens(tokens as any)

    // Output order should match input order, NOT alphabetical
    expect(result[0].address).toBe('0xfirst')
    expect(result[1].address).toBe('0xsecond')
    expect(result[2].address).toBe('0xthird')
  })

  it('deduplicates by address and takes first occurrence', () => {
    const tokens = [
      makeToken({ providedId: '0xaaa', name: 'From PulseX', providerKey: 'pulsex', listKey: 'extended' }),
      makeToken({ providedId: '0xaaa', name: 'From DexScreener', providerKey: 'dexscreener', listKey: 'api' }),
      makeToken({ providedId: '0xbbb', name: 'Other Token', providerKey: 'coingecko', listKey: 'eth' }),
    ]

    const result = normalizeTokens(tokens as any)

    expect(result).toHaveLength(2)
    // First occurrence wins for metadata
    expect((result[0] as any).name).toBe('From PulseX')
    expect(result[0].address).toBe('0xaaa')
    expect(result[1].address).toBe('0xbbb')
  })

  it('collects sources from all duplicate rows', () => {
    const tokens = [
      makeToken({ providedId: '0xaaa', providerKey: 'pulsex', listKey: 'extended' }),
      makeToken({ providedId: '0xaaa', providerKey: 'dexscreener', listKey: 'api' }),
      makeToken({ providedId: '0xaaa', providerKey: 'coingecko', listKey: 'pulsechain' }),
    ]

    const result = normalizeTokens(tokens as any)

    expect(result).toHaveLength(1)
    expect(result[0].sources).toEqual(['pulsex/extended', 'dexscreener/api', 'coingecko/pulsechain'])
  })

  it('handles mixed: some tokens duplicated, some unique', () => {
    const tokens = [
      makeToken({ providedId: '0xaaa', name: 'TokenA', providerKey: 'pulsex', listKey: 'v1' }),
      makeToken({ providedId: '0xbbb', name: 'TokenB', providerKey: 'pulsex', listKey: 'v1' }),
      makeToken({ providedId: '0xaaa', name: 'TokenA', providerKey: 'dexscreener', listKey: 'api' }),
      makeToken({ providedId: '0xccc', name: 'TokenC', providerKey: 'coingecko', listKey: 'eth' }),
      makeToken({ providedId: '0xbbb', name: 'TokenB', providerKey: 'coingecko', listKey: 'eth' }),
    ]

    const result = normalizeTokens(tokens as any)

    // 3 unique addresses
    expect(result).toHaveLength(3)
    // Order should follow first appearance: aaa, bbb, ccc
    expect(result[0].address).toBe('0xaaa')
    expect(result[1].address).toBe('0xbbb')
    expect(result[2].address).toBe('0xccc')
    // Sources accumulated
    expect(result[0].sources).toEqual(['pulsex/v1', 'dexscreener/api'])
    expect(result[1].sources).toEqual(['pulsex/v1', 'coingecko/eth'])
    expect(result[2].sources).toEqual(['coingecko/eth'])
  })

  it('omits name, symbol, decimals when sansMetadata extension is set', () => {
    const tokens = [
      makeToken({ providedId: '0xaaa', name: 'TokenA', symbol: 'TKA', decimals: 18 }),
    ]

    const result = normalizeTokens(tokens as any, [], new Set(['sansMetadata']))

    expect(result).toHaveLength(1)
    expect(result[0]).not.toHaveProperty('name')
    expect(result[0]).not.toHaveProperty('symbol')
    expect(result[0]).not.toHaveProperty('decimals')
    expect(result[0].chainId).toBe(369)
    expect(result[0].address).toBe('0xaaa')
  })

  it('includes name, symbol, decimals when sansMetadata is NOT set', () => {
    const tokens = [
      makeToken({ providedId: '0xaaa', name: 'TokenA', symbol: 'TKA', decimals: 8 }),
    ]

    const result = normalizeTokens(tokens as any, [], new Set())

    expect(result).toHaveLength(1)
    expect((result[0] as any).name).toBe('TokenA')
    expect((result[0] as any).symbol).toBe('TKA')
    expect((result[0] as any).decimals).toBe(8)
  })

  it('applies filter functions to exclude non-matching tokens', () => {
    const tokens = [
      makeToken({ providedId: '0xaaa', chainId: '369' }),
      makeToken({ providedId: '0xbbb', chainId: '1' }),
      makeToken({ providedId: '0xccc', chainId: '369' }),
    ]

    const chainFilter = (a: any) => `${a.chainId}` === '369'
    const result = normalizeTokens(tokens as any, [chainFilter])

    expect(result).toHaveLength(2)
    expect(result[0].address).toBe('0xaaa')
    expect(result[1].address).toBe('0xccc')
  })

  it('applies multiple filters (AND logic via overEvery)', () => {
    const tokens = [
      makeToken({ providedId: '0xaaa', chainId: '369', decimals: 18 }),
      makeToken({ providedId: '0xbbb', chainId: '369', decimals: 8 }),
      makeToken({ providedId: '0xccc', chainId: '1', decimals: 18 }),
    ]

    const chainFilter = (a: any) => `${a.chainId}` === '369'
    const decimalsFilter = (a: any) => a.decimals === 18
    const result = normalizeTokens(tokens as any, [chainFilter, decimalsFilter])

    expect(result).toHaveLength(1)
    expect(result[0].address).toBe('0xaaa')
  })

  it('omits sources when providerKey or listKey are missing', () => {
    const tokens = [
      makeToken({ providedId: '0xaaa', providerKey: '', listKey: '' }),
    ]

    const result = normalizeTokens(tokens as any)

    expect(result).toHaveLength(1)
    expect(result[0]).not.toHaveProperty('sources')
  })

  it('omits sources when providerKey is null', () => {
    const tokens = [
      makeToken({ providedId: '0xaaa', providerKey: null, listKey: 'list-a' }),
    ]

    const result = normalizeTokens(tokens as any)

    expect(result).toHaveLength(1)
    expect(result[0]).not.toHaveProperty('sources')
  })

  it('deduplicates sources across duplicate rows', () => {
    const tokens = [
      makeToken({ providedId: '0xaaa', providerKey: 'pulsex', listKey: 'extended' }),
      makeToken({ providedId: '0xaaa', providerKey: 'pulsex', listKey: 'extended' }),
    ]

    const result = normalizeTokens(tokens as any)

    expect(result).toHaveLength(1)
    expect(result[0].sources).toEqual(['pulsex/extended'])
  })

  it('returns empty array for empty input', () => {
    const result = normalizeTokens([], [])
    expect(result).toEqual([])
  })

  it('adds bridgeInfo extension when bridgeInfo is in extensions set', () => {
    // All addresses must be valid lowercase hex (40 chars after 0x) for viem.isAddress
    const nativeAddr = '0x1111111111111111111111111111111111111111'
    const bridgedAddr = '0x2222222222222222222222222222222222222222'
    const homeAddr = '0x3333333333333333333333333333333333333333'
    const foreignAddr = '0x4444444444444444444444444444444444444444'
    const tokens = [
      makeToken({
        providedId: nativeAddr,
        chainId: '369',
        bridge: {
          bridgeId: 'bridge-1',
          homeAddress: homeAddr,
          foreignAddress: foreignAddr,
        },
        networkA: { chainId: '369' },
        networkB: { chainId: '1' },
        nativeToken: { providedId: nativeAddr },
        bridgedToken: { providedId: bridgedAddr },
      }),
    ]

    const result = normalizeTokens(tokens as any, [], new Set(['bridgeInfo']))

    expect(result).toHaveLength(1)
    expect(result[0].extensions).toBeDefined()
    expect(result[0].extensions!.bridgeInfo).toBeDefined()
    // Token is on chain 369, networkA is also 369, so networkNotSelf = networkB (chain 1)
    // getAddress(providedId) === getAddress(nativeToken.providedId), so tokenNotSelf = bridgedToken
    // tokenIsNative = false (tokenNotSelf is bridgedToken, not nativeToken)
    // originationBridgeAddress = !tokenIsNative → homeAddress
    // destinationBridgeAddress = !tokenIsNative → foreignAddress
    expect(result[0].extensions!.bridgeInfo![1]).toEqual({
      tokenAddress: bridgedAddr,
      originationBridgeAddress: homeAddr,
      destinationBridgeAddress: foreignAddr,
    })
  })

  it('does not add extensions when bridgeId is missing', () => {
    const tokens = [
      makeToken({
        providedId: '0x1111111111111111111111111111111111111111',
        bridge: { bridgeId: null, homeAddress: null, foreignAddress: null },
        networkA: { chainId: '369' },
        networkB: { chainId: '1' },
        nativeToken: { providedId: '0x1111111111111111111111111111111111111111' },
        bridgedToken: { providedId: '0x2222222222222222222222222222222222222222' },
      }),
    ]

    const result = normalizeTokens(tokens as any, [], new Set(['bridgeInfo']))

    expect(result).toHaveLength(1)
    expect(result[0].extensions).toBeUndefined()
  })

  it('adds headerUri extension when headerUri is in extensions set', () => {
    const tokens = [
      makeToken({
        providedId: '0xaaa',
        headerImageHash: 'header123',
        bridge: { bridgeId: null },
      }),
    ]

    const result = normalizeTokens(tokens as any, [], new Set(['headerUri']))

    // headerUri is always added (even without bridge extension), but extensions
    // are only attached if everAddedExtension is true (which requires bridgeInfo).
    // Since bridgeId is null, everAddedExtension stays false, so no extensions on output.
    expect(result).toHaveLength(1)
    expect(result[0].extensions).toBeUndefined()
  })

  it('adds headerUri alongside bridgeInfo when both are in extensions', () => {
    const nativeAddr = '0x1111111111111111111111111111111111111111'
    const bridgedAddr = '0x2222222222222222222222222222222222222222'
    const homeAddr = '0x3333333333333333333333333333333333333333'
    const foreignAddr = '0x4444444444444444444444444444444444444444'
    const tokens = [
      makeToken({
        providedId: nativeAddr,
        chainId: '369',
        headerImageHash: 'header456',
        ext: '.png',
        bridge: {
          bridgeId: 'bridge-1',
          homeAddress: homeAddr,
          foreignAddress: foreignAddr,
        },
        networkA: { chainId: '369' },
        networkB: { chainId: '1' },
        nativeToken: { providedId: nativeAddr },
        bridgedToken: { providedId: bridgedAddr },
      }),
    ]

    const result = normalizeTokens(tokens as any, [], new Set(['bridgeInfo', 'headerUri']))

    expect(result).toHaveLength(1)
    expect(result[0].extensions).toBeDefined()
    expect(result[0].extensions!.bridgeInfo).toBeDefined()
    // headerUri is set via directUri mock — it receives the tkn with imageHash overridden to headerImageHash
    expect(result[0].extensions!.headerUri).toBeDefined()
  })

  it('uses networkA as networkNotSelf when token chainId matches networkB', () => {
    const nativeAddr = '0x1111111111111111111111111111111111111111'
    const bridgedAddr = '0x2222222222222222222222222222222222222222'
    const homeAddr = '0x3333333333333333333333333333333333333333'
    const foreignAddr = '0x4444444444444444444444444444444444444444'
    const tokens = [
      makeToken({
        providedId: nativeAddr,
        chainId: '1',
        bridge: {
          bridgeId: 'bridge-1',
          homeAddress: homeAddr,
          foreignAddress: foreignAddr,
        },
        networkA: { chainId: '369' },
        networkB: { chainId: '1' },
        nativeToken: { providedId: nativeAddr },
        bridgedToken: { providedId: bridgedAddr },
      }),
    ]

    const result = normalizeTokens(tokens as any, [], new Set(['bridgeInfo']))

    expect(result).toHaveLength(1)
    expect(result[0].extensions).toBeDefined()
    // chainId is 1, which matches networkB, so networkNotSelf = networkA (chain 369)
    expect(result[0].extensions!.bridgeInfo![369]).toBeDefined()
    expect(result[0].extensions!.bridgeInfo![369].tokenAddress).toBe(bridgedAddr)
  })

  it('selects nativeToken as tokenNotSelf when providedId does NOT match nativeToken', () => {
    // providedId is the bridged token, so tokenNotSelf = nativeToken, tokenIsNative = true
    const nativeAddr = '0x1111111111111111111111111111111111111111'
    const bridgedAddr = '0x2222222222222222222222222222222222222222'
    const homeAddr = '0x3333333333333333333333333333333333333333'
    const foreignAddr = '0x4444444444444444444444444444444444444444'
    const tokens = [
      makeToken({
        providedId: bridgedAddr,
        chainId: '1',
        bridge: {
          bridgeId: 'bridge-1',
          homeAddress: homeAddr,
          foreignAddress: foreignAddr,
        },
        networkA: { chainId: '369' },
        networkB: { chainId: '1' },
        nativeToken: { providedId: nativeAddr },
        bridgedToken: { providedId: bridgedAddr },
      }),
    ]

    const result = normalizeTokens(tokens as any, [], new Set(['bridgeInfo']))

    expect(result).toHaveLength(1)
    expect(result[0].extensions!.bridgeInfo![369]).toBeDefined()
    // tokenNotSelf = nativeToken, tokenIsNative = true
    // originationBridgeAddress = foreignAddress (tokenIsNative → foreign)
    // destinationBridgeAddress = homeAddress (tokenIsNative → home)
    expect(result[0].extensions!.bridgeInfo![369]).toEqual({
      tokenAddress: nativeAddr,
      originationBridgeAddress: foreignAddr,
      destinationBridgeAddress: homeAddr,
    })
  })
})

describe('tokenFilters', () => {
  it('returns empty array when query is empty', () => {
    const filters = tokenFilters({})
    expect(filters).toEqual([])
  })

  it('returns empty array when chainId and decimals are undefined', () => {
    const filters = tokenFilters({ chainId: undefined, decimals: undefined })
    expect(filters).toEqual([])
  })

  it('creates a chainId filter for a single numeric value', () => {
    const filters = tokenFilters({ chainId: '369' })
    expect(filters).toHaveLength(1)

    const filter = filters[0]
    expect(filter({ chainId: '369', decimals: 18 } as any)).toBe(true)
    expect(filter({ chainId: '1', decimals: 18 } as any)).toBe(false)
  })

  it('creates a chainId filter for a numeric value (not string)', () => {
    const filters = tokenFilters({ chainId: 369 })
    expect(filters).toHaveLength(1)

    const filter = filters[0]
    expect(filter({ chainId: '369', decimals: 18 } as any)).toBe(true)
    expect(filter({ chainId: 369, decimals: 18 } as any)).toBe(true)
    expect(filter({ chainId: '1', decimals: 18 } as any)).toBe(false)
  })

  it('creates a chainId filter for array values', () => {
    const filters = tokenFilters({ chainId: ['1', '369'] })
    expect(filters).toHaveLength(1)

    const filter = filters[0]
    expect(filter({ chainId: '369', decimals: 18 } as any)).toBe(true)
    expect(filter({ chainId: '1', decimals: 18 } as any)).toBe(true)
    expect(filter({ chainId: '56', decimals: 18 } as any)).toBe(false)
  })

  it('creates a decimals filter for a single string value', () => {
    // _.toArray('18') splits into ['1', '8'], so the set becomes {1, 8}
    // This means a single-string decimals value matches individual digit values
    const filters = tokenFilters({ decimals: '18' })
    expect(filters).toHaveLength(1)

    const filter = filters[0]
    expect(filter({ chainId: '369', decimals: 1 } as any)).toBe(true)
    expect(filter({ chainId: '369', decimals: 8 } as any)).toBe(true)
    expect(filter({ chainId: '369', decimals: 18 } as any)).toBe(false)
  })

  it('creates a decimals filter for a single-digit string', () => {
    // _.toArray('8') splits into ['8'], so the set becomes {8}
    const filters = tokenFilters({ decimals: '8' })
    expect(filters).toHaveLength(1)

    const filter = filters[0]
    expect(filter({ chainId: '369', decimals: 8 } as any)).toBe(true)
    expect(filter({ chainId: '369', decimals: 18 } as any)).toBe(false)
  })

  it('creates a decimals filter for a numeric value (empty set)', () => {
    // _.toArray(18) returns [] for numbers, so the set is empty — nothing matches
    const filters = tokenFilters({ decimals: 18 })
    expect(filters).toHaveLength(1)

    const filter = filters[0]
    expect(filter({ chainId: '369', decimals: 18 } as any)).toBe(false)
    expect(filter({ chainId: '369', decimals: 6 } as any)).toBe(false)
  })

  it('creates a decimals filter for array values', () => {
    const filters = tokenFilters({ decimals: ['18', '8'] })
    expect(filters).toHaveLength(1)

    const filter = filters[0]
    expect(filter({ chainId: '369', decimals: 18 } as any)).toBe(true)
    expect(filter({ chainId: '369', decimals: 8 } as any)).toBe(true)
    expect(filter({ chainId: '369', decimals: 6 } as any)).toBe(false)
  })

  it('creates both chainId and decimals filters when both are provided', () => {
    const filters = tokenFilters({ chainId: '369', decimals: ['18', '8'] })
    expect(filters).toHaveLength(2)

    // First filter is chainId
    expect(filters[0]({ chainId: '369', decimals: 8 } as any)).toBe(true)
    expect(filters[0]({ chainId: '1', decimals: 18 } as any)).toBe(false)

    // Second filter is decimals (array input works correctly with _.toArray)
    expect(filters[1]({ chainId: '1', decimals: 18 } as any)).toBe(true)
    expect(filters[1]({ chainId: '369', decimals: 8 } as any)).toBe(true)
    expect(filters[1]({ chainId: '369', decimals: 6 } as any)).toBe(false)
  })
})

describe('minimalList', () => {
  it('returns a TokenList with empty name and zero version', () => {
    const tokens = [
      { chainId: 369, address: '0xaaa', name: 'Token', symbol: 'TKN', decimals: 18 },
    ] as any

    const result = minimalList(tokens)

    expect(result.name).toBe('')
    expect(result.version).toEqual({ major: 0, minor: 0, patch: 0 })
    expect(result.tokens).toBe(tokens)
  })

  it('returns a valid ISO timestamp', () => {
    const result = minimalList([])
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('passes through the tokens array unchanged', () => {
    const tokens = [
      { chainId: 1, address: '0xaaa', name: 'A', symbol: 'A', decimals: 18 },
      { chainId: 369, address: '0xbbb', name: 'B', symbol: 'B', decimals: 8 },
    ] as any

    const result = minimalList(tokens)

    expect(result.tokens).toHaveLength(2)
    expect(result.tokens[0]).toBe(tokens[0])
    expect(result.tokens[1]).toBe(tokens[1])
  })

  it('returns an empty tokens array when given empty input', () => {
    const result = minimalList([])
    expect(result.tokens).toEqual([])
  })
})

describe('respondWithList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createMockResponse() {
    const res = {
      set: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }
    return res as unknown as { set: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> }
  }

  function createMockQuery(tokens: unknown[]) {
    const query = {
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(tokens),
    }
    mockGetTokensUnderListId.mockReturnValue(query)
    return query
  }

  const baseList = {
    listId: 'list-1',
    name: 'Test List',
    imageHash: 'listhash',
    ext: '.png',
    mode: 'save',
    uri: null,
    updatedAt: '2024-01-15T12:00:00Z',
    major: 1,
    minor: 2,
    patch: 3,
  }

  it('queries db, normalizes tokens, and responds with JSON', async () => {
    const tokens = [
      makeToken({ providedId: '0xaaa', name: 'TokenA', providerKey: 'px', listKey: 'ext' }),
    ]
    createMockQuery(tokens)
    const res = createMockResponse()

    await respondWithList(res as any, baseList, [], new Set())

    expect(mockGetTokensUnderListId).toHaveBeenCalled()
    expect(res.set).toHaveBeenCalledWith('cache-control', 'public, max-age=86400')
    expect(res.json).toHaveBeenCalledTimes(1)

    const body = res.json.mock.calls[0][0]
    expect(body.name).toBe('Test List')
    expect(body.version).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(body.timestamp).toBe('2024-01-15T12:00:00.000Z')
    expect(body.tokens).toHaveLength(1)
    expect(body.tokens[0].address).toBe('0xaaa')
  })

  it('falls back to empty name when list.name is null', async () => {
    createMockQuery([])
    const res = createMockResponse()

    await respondWithList(res as any, { ...baseList, name: null }, [], new Set())

    const body = res.json.mock.calls[0][0]
    expect(body.name).toBe('')
  })

  it('falls back to zero version when major/minor/patch are falsy', async () => {
    createMockQuery([])
    const res = createMockResponse()

    await respondWithList(
      res as any,
      { ...baseList, major: 0, minor: 0, patch: 0 },
      [],
      new Set(),
    )

    const body = res.json.mock.calls[0][0]
    expect(body.version).toEqual({ major: 0, minor: 0, patch: 0 })
  })

  it('calls addBridgeExtensions when bridgeInfo extension is requested', async () => {
    const query = createMockQuery([])
    mockAddBridgeExtensions.mockReturnValue(query)
    const res = createMockResponse()

    await respondWithList(res as any, baseList, [], new Set(['bridgeInfo']))

    expect(mockAddBridgeExtensions).toHaveBeenCalled()
  })

  it('calls addHeaderUriExtension when headerUri extension is requested', async () => {
    const query = createMockQuery([])
    mockAddHeaderUriExtension.mockReturnValue(query)
    const res = createMockResponse()

    await respondWithList(res as any, baseList, [], new Set(['headerUri']))

    expect(mockAddHeaderUriExtension).toHaveBeenCalled()
  })

  it('does not call bridge/header extensions when not requested', async () => {
    createMockQuery([])
    const res = createMockResponse()

    await respondWithList(res as any, baseList, [], new Set())

    expect(mockAddBridgeExtensions).not.toHaveBeenCalled()
    expect(mockAddHeaderUriExtension).not.toHaveBeenCalled()
  })

  it('passes filters through to normalizeTokens', async () => {
    const tokens = [
      makeToken({ providedId: '0xaaa', chainId: '369' }),
      makeToken({ providedId: '0xbbb', chainId: '1' }),
    ]
    createMockQuery(tokens)
    const res = createMockResponse()

    const chainFilter = (a: any) => `${a.chainId}` === '369'
    await respondWithList(res as any, baseList, [chainFilter], new Set())

    const body = res.json.mock.calls[0][0]
    expect(body.tokens).toHaveLength(1)
    expect(body.tokens[0].address).toBe('0xaaa')
  })

  it('includes logoURI from directUri in the response', async () => {
    createMockQuery([])
    const res = createMockResponse()

    await respondWithList(res as any, baseList, [], new Set())

    const body = res.json.mock.calls[0][0]
    expect(body.logoURI).toBe('/image/direct/listhash.png')
  })
})
