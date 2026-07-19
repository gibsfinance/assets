import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetTokensUnderListId = vi.fn()
const mockGetTokensWithExtensions = vi.fn()

vi.mock('../../db/tables', () => ({
  imageMode: { SAVE: 'save', LINK: 'link' },
}))
vi.mock('../../db', async () => {
  // Use the real normalizeProvidedId (isAddress ? lower : preserve) so the base58
  // case-preservation behavior is exercised, not stubbed away.
  const { normalizeProvidedId } = await vi.importActual<typeof import('../../db/provided-id')>('../../db/provided-id')
  return {
    getTokensUnderListId: (...args: unknown[]) => mockGetTokensUnderListId(...args),
    getTokensWithExtensions: (...args: unknown[]) => mockGetTokensWithExtensions(...args),
    normalizeProvidedId,
  }
})
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

import {
  normalizeTokens,
  tokenFilters,
  minimalList,
  respondWithList,
  parseExtensions,
  parseTokenLimit,
  parseListFilters,
} from './utils'

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
  // chainId alone cannot say which chain 501 is, and the envelope minimalList builds
  // for /list/merged and provider lists names no chain at all — so without this the
  // namespace is unrecoverable from those responses.
  it('carries the stored identifier alongside the numeric chain id', () => {
    const [entry] = normalizeTokens([makeToken({ chainId: 'eip155-369' })] as any)
    expect(entry.chainId).toBe(369)
    expect(entry.chainIdentifier).toBe('eip155-369')
  })

  it('keeps a non-Ethereum-Virtual-Machine namespace intact', () => {
    const [entry] = normalizeTokens([makeToken({ chainId: 'solana-501', providedId: 'So111' })] as any)
    expect(entry.chainId).toBe(501)
    expect(entry.chainIdentifier).toBe('solana-501')
  })

  it('derives the identifier for a bare stored id rather than emitting a bare value', () => {
    const [entry] = normalizeTokens([makeToken({ chainId: '369' })] as any)
    expect(entry.chainIdentifier).toBe('eip155-369')
  })

  // The dedup map was keyed on `${chainId}-${address}` with the flattened number, so
  // two chains sharing a number and an address string collapsed into one entry and
  // one was silently dropped. Keyed on the identifier, both survive.
  it('does not collapse same-numbered chains from different namespaces', () => {
    const result = normalizeTokens([
      makeToken({ chainId: 'eip155-501', providedId: '0xaaa', name: 'Evm Token' }),
      makeToken({ chainId: 'solana-501', providedId: '0xaaa', name: 'Solana Token' }),
    ] as any)

    expect(result).toHaveLength(2)
    expect(result.map((entry) => entry.chainIdentifier).sort()).toEqual(['eip155-501', 'solana-501'])
  })

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

  it('returns base58 (Solana, Tron) ids with their case intact', () => {
    // The token-image URL and any copy-paste of the returned address must round-trip.
    // A bare .toLowerCase() here would hand back an unusable, non-existent mint.
    const SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const TRON_ADDR = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
    const tokens = [
      makeToken({ providedId: SOLANA_MINT, chainId: 'solana-501', providerKey: 'trustwallet', listKey: 'wallet' }),
      makeToken({ providedId: TRON_ADDR, chainId: 'tvm-195', providerKey: 'trustwallet', listKey: 'wallet' }),
    ]

    const result = normalizeTokens(tokens as any)

    expect(result.map((r) => r.address)).toEqual([SOLANA_MINT, TRON_ADDR])
  })

  it('still lowercases Ethereum-Virtual-Machine addresses to a canonical form', () => {
    // A checksummed address (USDC) — normalizeProvidedId lowercases it to the canonical form.
    const tokens = [makeToken({ providedId: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chainId: 'eip155-1' })]

    const result = normalizeTokens(tokens as any)

    expect(result[0].address).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
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
    const tokens = [makeToken({ providedId: '0xaaa', name: 'TokenA', symbol: 'TKA', decimals: 18 })]

    const result = normalizeTokens(tokens as any, [], new Set(['sansMetadata']))

    expect(result).toHaveLength(1)
    expect(result[0]).not.toHaveProperty('name')
    expect(result[0]).not.toHaveProperty('symbol')
    expect(result[0]).not.toHaveProperty('decimals')
    expect(result[0].chainId).toBe(369)
    expect(result[0].address).toBe('0xaaa')
  })

  it('includes name, symbol, decimals when sansMetadata is NOT set', () => {
    const tokens = [makeToken({ providedId: '0xaaa', name: 'TokenA', symbol: 'TKA', decimals: 8 })]

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
    const tokens = [makeToken({ providedId: '0xaaa', providerKey: '', listKey: '' })]

    const result = normalizeTokens(tokens as any)

    expect(result).toHaveLength(1)
    expect(result[0]).not.toHaveProperty('sources')
  })

  it('omits sources when providerKey is null', () => {
    const tokens = [makeToken({ providedId: '0xaaa', providerKey: null, listKey: 'list-a' })]

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

  it('attaches extensions for headerUri-only requests when header data exists', () => {
    const tokens = [
      makeToken({
        providedId: '0xaaa',
        headerImageHash: 'header123',
        bridge: { bridgeId: null },
      }),
    ]

    const result = normalizeTokens(tokens as any, [], new Set(['headerUri']))

    // Regression: extensions used to attach only when a bridgeInfo entry was
    // added in the same group, so ?extensions=headerUri alone never emitted
    // the header image even when it existed.
    expect(result).toHaveLength(1)
    expect(result[0].extensions).toBeDefined()
    expect(result[0].extensions!.headerUri).toBe('/image/direct/header123.png')
    // No bridgeInfo was requested or collected — the empty placeholder must not leak.
    expect(result[0].extensions).not.toHaveProperty('bridgeInfo')
  })

  it('does not attach extensions for headerUri-only requests when no header image exists', () => {
    const tokens = [
      makeToken({
        providedId: '0xaaa',
        headerImageHash: null,
        bridge: { bridgeId: null },
      }),
    ]

    const result = normalizeTokens(tokens as any, [], new Set(['headerUri']))

    expect(result).toHaveLength(1)
    expect(result[0].extensions).toBeUndefined()
  })

  it('keys bridgeInfo by bare numeric chain id when row chain ids are prefixed', () => {
    // Regression: production rows carry prefixed chain ids (eip155-1), and
    // +'eip155-1' is NaN — bridgeInfo used to emit a literal "NaN" key and
    // mis-pick the counterpart network.
    const nativeAddr = '0x1111111111111111111111111111111111111111'
    const bridgedAddr = '0x2222222222222222222222222222222222222222'
    const homeAddr = '0x3333333333333333333333333333333333333333'
    const foreignAddr = '0x4444444444444444444444444444444444444444'
    const tokens = [
      makeToken({
        providedId: nativeAddr,
        chainId: 'eip155-369',
        bridge: {
          bridgeId: 'bridge-1',
          homeAddress: homeAddr,
          foreignAddress: foreignAddr,
        },
        networkA: { chainId: 'eip155-369' },
        networkB: { chainId: 'eip155-1' },
        nativeToken: { providedId: nativeAddr },
        bridgedToken: { providedId: bridgedAddr },
      }),
    ]

    const result = normalizeTokens(tokens as any, [], new Set(['bridgeInfo']))

    expect(result).toHaveLength(1)
    expect(result[0].extensions!.bridgeInfo).not.toHaveProperty('NaN')
    // Token chain is eip155-369 = networkA, so the counterpart is networkB (chain 1)
    expect(result[0].extensions!.bridgeInfo![1]).toEqual({
      tokenAddress: bridgedAddr,
      originationBridgeAddress: homeAddr,
      destinationBridgeAddress: foreignAddr,
    })
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

  // Filters run against database rows, whose chainId is the stored CAIP-2
  // identifier — not the flattened number that reaches the response. An explicit
  // ?chainId=solana-501 used to match nothing at all, because the old code pushed
  // both sides through toCAIP2 and matched only by symmetry.
  it('matches an explicitly namespaced chainId, and only that namespace', () => {
    const filter = tokenFilters({ chainId: 'solana-501' })[0]
    expect(filter({ chainId: 'solana-501', decimals: 9 } as any)).toBe(true)
    // The whole point: an explicit namespace must not widen to a chain that merely
    // shares the number.
    expect(filter({ chainId: 'eip155-501', decimals: 18 } as any)).toBe(false)
    expect(filter({ chainId: 'eip155-1', decimals: 18 } as any)).toBe(false)
  })

  // A bare number names no namespace, so it spans them — the caller asked for
  // "chain 501", and both rows honestly answer to that.
  it('matches a bare chainId across every namespace sharing the number', () => {
    const filter = tokenFilters({ chainId: '501' })[0]
    expect(filter({ chainId: 'solana-501', decimals: 9 } as any)).toBe(true)
    expect(filter({ chainId: 'eip155-501', decimals: 18 } as any)).toBe(true)
    expect(filter({ chainId: 'eip155-369', decimals: 18 } as any)).toBe(false)
  })

  it('creates a decimals filter for a single string value', () => {
    const filters = tokenFilters({ decimals: '18' })
    expect(filters).toHaveLength(1)

    const filter = filters[0]
    expect(filter({ chainId: '369', decimals: 18 } as any)).toBe(true)
    expect(filter({ chainId: '369', decimals: 1 } as any)).toBe(false)
    expect(filter({ chainId: '369', decimals: 8 } as any)).toBe(false)
  })

  it('creates a decimals filter for a single-digit string', () => {
    const filters = tokenFilters({ decimals: '8' })
    expect(filters).toHaveLength(1)

    const filter = filters[0]
    expect(filter({ chainId: '369', decimals: 8 } as any)).toBe(true)
    expect(filter({ chainId: '369', decimals: 18 } as any)).toBe(false)
  })

  it('creates a decimals filter for a numeric value', () => {
    const filters = tokenFilters({ decimals: 18 })
    expect(filters).toHaveLength(1)

    const filter = filters[0]
    expect(filter({ chainId: '369', decimals: 18 } as any)).toBe(true)
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

  it('matches prefixed row chain ids when the query uses a bare id', () => {
    // Regression: stored rows carry prefixed ids (eip155-369); the filter used
    // to compare the raw query value, so ?chainId=369 silently returned zero
    // tokens on /list/merged/{order} and /list/{providerKey}/{listKey}.
    const filters = tokenFilters({ chainId: '369' })
    expect(filters[0]({ chainId: 'eip155-369', decimals: 18 } as any)).toBe(true)
    expect(filters[0]({ chainId: 'eip155-1', decimals: 18 } as any)).toBe(false)
  })

  it('returns identical results for bare and prefixed query values', () => {
    const bare = tokenFilters({ chainId: '369' })[0]
    const prefixed = tokenFilters({ chainId: 'eip155-369' })[0]
    const rows = [{ chainId: 'eip155-369' }, { chainId: 'eip155-1' }, { chainId: '369' }]
    for (const row of rows) {
      expect(bare(row as any)).toBe(prefixed(row as any))
    }
  })

  it('creates both chainId and decimals filters when both are provided', () => {
    const filters = tokenFilters({ chainId: '369', decimals: ['18', '8'] })
    expect(filters).toHaveLength(2)

    // First filter is chainId
    expect(filters[0]({ chainId: '369', decimals: 8 } as any)).toBe(true)
    expect(filters[0]({ chainId: '1', decimals: 18 } as any)).toBe(false)

    // Second filter is decimals
    expect(filters[1]({ chainId: '1', decimals: 18 } as any)).toBe(true)
    expect(filters[1]({ chainId: '369', decimals: 8 } as any)).toBe(true)
    expect(filters[1]({ chainId: '369', decimals: 6 } as any)).toBe(false)
  })
})

describe('parseExtensions', () => {
  it('splits the documented comma-separated form', () => {
    // Regression: extensions=bridgeInfo,headerUri used to arrive as one literal
    // name and silently match nothing.
    expect(parseExtensions('bridgeInfo,headerUri')).toEqual(new Set(['bridgeInfo', 'headerUri']))
  })

  it('keeps supporting repeated parameters', () => {
    expect(parseExtensions(['bridgeInfo', 'headerUri'])).toEqual(new Set(['bridgeInfo', 'headerUri']))
  })

  it('splits commas inside repeated parameters', () => {
    expect(parseExtensions(['bridgeInfo,headerUri', 'sansMetadata'])).toEqual(
      new Set(['bridgeInfo', 'headerUri', 'sansMetadata']),
    )
  })

  it('drops empty segments and trims whitespace', () => {
    expect(parseExtensions('bridgeInfo,, headerUri ,')).toEqual(new Set(['bridgeInfo', 'headerUri']))
  })

  it('returns an empty set for missing values', () => {
    expect(parseExtensions(undefined)).toEqual(new Set())
    expect(parseExtensions('')).toEqual(new Set())
  })
})

describe('parseTokenLimit', () => {
  const options = { fallback: 50_000, max: 100_000 }

  it('passes valid limits through', () => {
    expect(parseTokenLimit('20', options)).toBe(20)
    expect(parseTokenLimit('1', options)).toBe(1)
  })

  it('clamps to the documented maximum', () => {
    expect(parseTokenLimit('200000', options)).toBe(100_000)
  })

  it('falls back on negative and zero limits — a negative limit must never reach slice()', () => {
    // Regression: slice(0, -5) silently drops tokens from the end of the list.
    expect(parseTokenLimit('-5', options)).toBe(50_000)
    expect(parseTokenLimit('0', options)).toBe(50_000)
  })

  it('falls back on non-numeric and missing limits', () => {
    expect(parseTokenLimit('banana', options)).toBe(50_000)
    expect(parseTokenLimit(undefined, options)).toBe(50_000)
  })

  it('floors fractional limits', () => {
    expect(parseTokenLimit('10.9', options)).toBe(10)
    // 0.5 floors to 0, which is below the minimum — fallback, not slice(0, 0)
    expect(parseTokenLimit('0.5', options)).toBe(50_000)
  })
})

describe('parseListFilters', () => {
  it('rejects non-boolean default values with 400 — they used to 500 in Postgres', () => {
    let caught: { status?: number } | undefined
    try {
      parseListFilters({ default: 'banana' })
    } catch (err) {
      caught = err as { status?: number }
    }
    expect(caught?.status).toBe(400)
  })

  it('converts default to a real boolean', () => {
    expect(parseListFilters({ default: 'true' })).toEqual({ default: true })
    expect(parseListFilters({ default: 'false' })).toEqual({ default: false })
  })

  // Bare chain ids now pass through untouched. The original fix prefixed them here
  // so ?chain_id=369 would equal the stored eip155-369 — correct for EVM chains, but
  // it also made ?chain_id=501 mean eip155-501, putting lists on solana-501 out of
  // reach by number. Matching moved to the query builder, which compares a bare value
  // against the stored id's reference (see chainIdFilterMatch); the parser no longer
  // decides namespace. ?chain_id=369 still reaches eip155-369 — via the reference.
  it('passes chain ids through without assuming a namespace', () => {
    expect(parseListFilters({ chain_id: '369' })).toEqual({ chain_id: '369' })
    expect(parseListFilters({ chain_id: '501' })).toEqual({ chain_id: '501' })
    expect(parseListFilters({ chain_id: 'eip155-369' })).toEqual({ chain_id: 'eip155-369' })
    expect(parseListFilters({ chain_id: 'solana-501' })).toEqual({ chain_id: 'solana-501' })
  })

  it('passes each element of an array chain_id filter through', () => {
    expect(parseListFilters({ chain_id: ['369', 'eip155-1'] })).toEqual({ chain_id: ['369', 'eip155-1'] })
  })

  it('rejects empty values with 400', () => {
    expect(() => parseListFilters({ key: '' })).toThrowError(/non-empty/)
  })

  it('rejects non-integer version filters with 400', () => {
    expect(() => parseListFilters({ major: 'banana' })).toThrowError(/integer/)
  })

  it('converts version filters to numbers', () => {
    expect(parseListFilters({ major: '1', minor: '0', patch: '2' })).toEqual({ major: 1, minor: 0, patch: 2 })
  })

  it('passes plain string filters through untouched', () => {
    expect(parseListFilters({ key: 'extended', provider_key: 'pulsex', name: 'PulseX' })).toEqual({
      key: 'extended',
      provider_key: 'pulsex',
      name: 'PulseX',
    })
  })
})

describe('minimalList', () => {
  it('returns a TokenList with empty name and zero version', () => {
    const tokens = [{ chainId: 369, address: '0xaaa', name: 'Token', symbol: 'TKN', decimals: 18 }] as any

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
    const tokens = [makeToken({ providedId: '0xaaa', name: 'TokenA', providerKey: 'px', listKey: 'ext' })]
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

    await respondWithList(res as any, { ...baseList, major: 0, minor: 0, patch: 0 }, [], new Set())

    const body = res.json.mock.calls[0][0]
    expect(body.version).toEqual({ major: 0, minor: 0, patch: 0 })
  })

  it('uses getTokensWithExtensions when bridgeInfo extension is requested', async () => {
    mockGetTokensWithExtensions.mockResolvedValue([])
    const res = createMockResponse()

    await respondWithList(res as any, baseList, [], new Set(['bridgeInfo']))

    expect(mockGetTokensWithExtensions).toHaveBeenCalledWith('list-1', { bridgeInfo: true, headerUri: false })
    expect(mockGetTokensUnderListId).not.toHaveBeenCalled()
  })

  it('uses getTokensWithExtensions when headerUri extension is requested', async () => {
    mockGetTokensWithExtensions.mockResolvedValue([])
    const res = createMockResponse()

    await respondWithList(res as any, baseList, [], new Set(['headerUri']))

    expect(mockGetTokensWithExtensions).toHaveBeenCalledWith('list-1', { bridgeInfo: false, headerUri: true })
    expect(mockGetTokensUnderListId).not.toHaveBeenCalled()
  })

  it('uses getTokensUnderListId when no extensions are requested', async () => {
    createMockQuery([])
    const res = createMockResponse()

    await respondWithList(res as any, baseList, [], new Set())

    expect(mockGetTokensUnderListId).toHaveBeenCalled()
    expect(mockGetTokensWithExtensions).not.toHaveBeenCalled()
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
