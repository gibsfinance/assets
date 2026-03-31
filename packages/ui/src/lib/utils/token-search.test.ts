import { describe, it, expect } from 'vitest'
import {
  filterTokensBySearch,
  sortTokensMainnetFirst,
  categorizeListsByScope,
  countResults,
  isCacheHit,
  parsePathParams,
  getPopularChains,
} from './token-search'
import type { Token } from '../types'

const makeToken = (overrides: Partial<Token> = {}): Token =>
  ({
    chainId: 1,
    address: '0xabc',
    name: 'Test Token',
    symbol: 'TST',
    decimals: 18,
    hasIcon: true,
    sourceList: 'test/default',
    ...overrides,
  }) as Token

// ---------------------------------------------------------------------------
// filterTokensBySearch
// ---------------------------------------------------------------------------
describe('filterTokensBySearch', () => {
  const tokens = [
    makeToken({ name: 'Wrapped Ether', symbol: 'WETH', address: '0xc02aaa' }),
    makeToken({ name: 'USD Coin', symbol: 'USDC', address: '0xa0b869' }),
    makeToken({ name: 'Dai Stablecoin', symbol: 'DAI', address: '0x6b175474' }),
  ]

  it('returns all tokens for empty search', () => {
    expect(filterTokensBySearch(tokens, '')).toHaveLength(3)
  })

  it('filters by name', () => {
    expect(filterTokensBySearch(tokens, 'ether')).toEqual([tokens[0]])
  })

  it('filters by symbol', () => {
    expect(filterTokensBySearch(tokens, 'usdc')).toEqual([tokens[1]])
  })

  it('filters by address', () => {
    expect(filterTokensBySearch(tokens, '6b175')).toEqual([tokens[2]])
  })

  it('is case-insensitive', () => {
    expect(filterTokensBySearch(tokens, 'DAI')).toEqual([tokens[2]])
    expect(filterTokensBySearch(tokens, 'dai')).toEqual([tokens[2]])
  })

  it('returns empty for no matches', () => {
    expect(filterTokensBySearch(tokens, 'zzz')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// sortTokensMainnetFirst
// ---------------------------------------------------------------------------
describe('sortTokensMainnetFirst', () => {
  it('sorts mainnet tokens before others', () => {
    const tokens = [
      makeToken({ chainId: 369, name: 'Bbb' }),
      makeToken({ chainId: 1, name: 'Aaa' }),
      makeToken({ chainId: 56, name: 'Ccc' }),
    ]
    const sorted = sortTokensMainnetFirst(tokens)
    expect(sorted[0].chainId).toBe(1)
  })

  it('sorts alphabetically within same chain priority', () => {
    const tokens = [
      makeToken({ chainId: 369, name: 'Zebra' }),
      makeToken({ chainId: 369, name: 'Apple' }),
    ]
    const sorted = sortTokensMainnetFirst(tokens)
    expect(sorted[0].name).toBe('Apple')
    expect(sorted[1].name).toBe('Zebra')
  })

  it('does not mutate the original array', () => {
    const tokens = [makeToken({ chainId: 369, name: 'B' }), makeToken({ chainId: 1, name: 'A' })]
    const copy = [...tokens]
    sortTokensMainnetFirst(tokens)
    expect(tokens).toEqual(copy)
  })
})

// ---------------------------------------------------------------------------
// categorizeListsByScope
// ---------------------------------------------------------------------------
describe('categorizeListsByScope', () => {
  it('separates global and chain-specific lists', () => {
    const lists = [
      { chainId: '0', name: 'global' },
      { chainId: '1', name: 'ethereum' },
      { chainId: '0', name: 'another-global' },
      { chainId: '369', name: 'pulsechain' },
    ]
    const result = categorizeListsByScope(lists)
    expect(result.global).toHaveLength(2)
    expect(result.chainSpecific).toHaveLength(2)
  })

  it('handles empty input', () => {
    const result = categorizeListsByScope([])
    expect(result.global).toHaveLength(0)
    expect(result.chainSpecific).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// countResults
// ---------------------------------------------------------------------------
describe('countResults', () => {
  it('extracts .total from response', () => {
    expect(countResults({ total: 42 })).toBe(42)
  })

  it('counts .tokens array length', () => {
    expect(countResults({ tokens: [1, 2, 3] })).toBe(3)
  })

  it('counts top-level array length', () => {
    expect(countResults([1, 2, 3, 4])).toBe(4)
  })

  it('returns null for non-object', () => {
    expect(countResults(null)).toBeNull()
    expect(countResults('string')).toBeNull()
    expect(countResults(42)).toBeNull()
  })

  it('returns null for object without recognized keys', () => {
    expect(countResults({ foo: 'bar' })).toBeNull()
  })

  it('prefers .total over .tokens', () => {
    expect(countResults({ total: 10, tokens: [1, 2] })).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// isCacheHit
// ---------------------------------------------------------------------------
describe('isCacheHit', () => {
  it('detects CF cache HIT', () => {
    const headers = new Headers({ 'cf-cache-status': 'HIT' })
    expect(isCacheHit(headers)).toBe(true)
  })

  it('detects x-cache HIT', () => {
    const headers = new Headers({ 'x-cache': 'HIT' })
    expect(isCacheHit(headers)).toBe(true)
  })

  it('returns false for MISS', () => {
    const headers = new Headers({ 'cf-cache-status': 'MISS' })
    expect(isCacheHit(headers)).toBe(false)
  })

  it('returns false for empty headers', () => {
    expect(isCacheHit(new Headers())).toBe(false)
  })

  it('is case-insensitive', () => {
    const headers = new Headers({ 'x-cache': 'hit' })
    expect(isCacheHit(headers)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// parsePathParams
// ---------------------------------------------------------------------------
describe('parsePathParams', () => {
  it('parses path with params', () => {
    const result = parsePathParams('/image/{chainId}/{address}')
    expect(result).toEqual([
      { text: '/image/', isParam: false },
      { text: '{chainId}', isParam: true },
      { text: '/', isParam: false },
      { text: '{address}', isParam: true },
    ])
  })

  it('handles path with no params', () => {
    const result = parsePathParams('/stats')
    expect(result).toEqual([{ text: '/stats', isParam: false }])
  })

  it('handles param at start', () => {
    const result = parsePathParams('{id}/details')
    expect(result).toEqual([
      { text: '{id}', isParam: true },
      { text: '/details', isParam: false },
    ])
  })
})

// ---------------------------------------------------------------------------
// getPopularChains
// ---------------------------------------------------------------------------
describe('getPopularChains', () => {
  const networks = [
    { chainId: 1 },
    { chainId: 369 },
    { chainId: 56 },
    { chainId: 11155111 }, // testnet
  ]

  const byChain: Record<number, number> = {
    1: 5000,
    369: 2000,
    56: 500,
    11155111: 50,
  }

  const getName = (id: number) => {
    const names: Record<number, string> = {
      1: 'Ethereum',
      369: 'PulseChain',
      56: 'BNB Smart Chain',
      11155111: 'Sepolia Testnet',
    }
    return names[id] || `Chain ${id}`
  }

  it('returns chains sorted by token count', () => {
    const result = getPopularChains(networks, byChain, getName)
    expect(result[0].name).toBe('Ethereum')
    expect(result[1].name).toBe('PulseChain')
  })

  it('excludes testnets', () => {
    const result = getPopularChains(networks, byChain, getName)
    expect(result.find((c) => c.name.includes('Testnet'))).toBeUndefined()
  })

  it('excludes chains below minTokens threshold', () => {
    const result = getPopularChains(networks, byChain, getName, { minTokens: 1000 })
    expect(result).toHaveLength(2) // only Ethereum and PulseChain
  })

  it('respects limit', () => {
    const result = getPopularChains(networks, byChain, getName, { limit: 1 })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Ethereum')
  })

  it('handles empty networks', () => {
    expect(getPopularChains([], {}, getName)).toHaveLength(0)
  })
})
