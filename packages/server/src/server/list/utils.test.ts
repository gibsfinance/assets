import { describe, it, expect, vi } from 'vitest'

vi.mock('../../db/tables', () => ({
  imageMode: { SAVE: 'save', LINK: 'link' },
}))
vi.mock('../../db', () => ({}))
vi.mock('../../db/drizzle', () => ({ getDrizzle: vi.fn() }))
vi.mock('../../db/schema', () => ({}))
vi.mock('../../utils', () => ({
  directUri: ({ imageHash, ext }: { imageHash: string; ext: string }) =>
    imageHash && ext ? `/image/direct/${imageHash}${ext}` : undefined,
}))
vi.mock('../../../config', () => ({
  default: { cacheSeconds: 86400, rootURI: 'http://test' },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  asc: vi.fn(),
}))

import { normalizeTokens } from './utils'

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
      makeToken({ providedId: '0xthird', name: 'Middle', symbol: 'MMM', providerKey: 'coingecko', listKey: 'ethereum' }),
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
    expect(result[0].sources).toEqual([
      'pulsex/extended',
      'dexscreener/api',
      'coingecko/pulsechain',
    ])
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
})
