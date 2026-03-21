import { describe, it, expect } from 'vitest'
import type { Token } from '../types'
import { deduplicateTokens } from './dedup-tokens'

function makeToken(
  address: string,
  sourceList: string,
  overrides: Partial<Token> = {},
): Token {
  return {
    chainId: 1,
    address,
    name: `Token ${address}`,
    symbol: address.slice(0, 4).toUpperCase(),
    decimals: 18,
    hasIcon: true,
    sourceList,
    ...overrides,
  }
}

describe('deduplicateTokens', () => {
  it('deduplicates tokens with the same address across lists', () => {
    const tokensByList = new Map([
      ['listA', [makeToken('0xabc', 'provA/listA')]],
      ['listB', [makeToken('0xabc', 'provB/listB')]],
    ])
    const result = deduplicateTokens(tokensByList, new Set(['listA', 'listB']), '1')
    expect(result).toHaveLength(1)
    expect(result[0].listReferences).toHaveLength(2)
  })

  it('keeps unique tokens separate', () => {
    const tokensByList = new Map([
      ['listA', [makeToken('0xabc', 'provA/listA'), makeToken('0xdef', 'provA/listA')]],
    ])
    const result = deduplicateTokens(tokensByList, new Set(['listA']), '1')
    expect(result).toHaveLength(2)
  })

  it('filters by chain', () => {
    const tokensByList = new Map([
      [
        'listA',
        [
          makeToken('0xabc', 'provA/listA', { chainId: 1 }),
          makeToken('0xdef', 'provA/listA', { chainId: 56 }),
        ],
      ],
    ])
    const result = deduplicateTokens(tokensByList, new Set(['listA']), '1')
    expect(result).toHaveLength(1)
    expect(result[0].address).toBe('0xabc')
  })

  it('skips disabled lists', () => {
    const tokensByList = new Map([
      ['listA', [makeToken('0xabc', 'provA/listA')]],
      ['listB', [makeToken('0xdef', 'provB/listB')]],
    ])
    const result = deduplicateTokens(tokensByList, new Set(['listA']), '1')
    expect(result).toHaveLength(1)
    expect(result[0].address).toBe('0xabc')
  })

  it('skips tokens without icons', () => {
    const token = makeToken('0xabc', 'provA/listA', { hasIcon: false })
    const tokensByList = new Map([['listA', [token]]])
    const result = deduplicateTokens(tokensByList, new Set(['listA']), '1')
    expect(result).toHaveLength(0)
  })

  it('does not duplicate same list reference', () => {
    const tokensByList = new Map([
      ['listA', [makeToken('0xabc', 'provA/listA'), makeToken('0xabc', 'provA/listA')]],
    ])
    const result = deduplicateTokens(tokensByList, new Set(['listA']), '1')
    expect(result).toHaveLength(1)
    expect(result[0].listReferences).toHaveLength(1)
  })

  it('processes non-bridge tokens before bridge tokens', () => {
    const tokensByList = new Map([
      ['bridge-list', [makeToken('0xabc', 'bridge/list')]],
      ['normal-list', [makeToken('0xabc', 'normal/list')]],
    ])
    const result = deduplicateTokens(
      tokensByList,
      new Set(['bridge-list', 'normal-list']),
      '1',
    )
    expect(result).toHaveLength(1)
    // Normal list should be the primary (processed first)
    expect(result[0].sourceList).toBe('normal/list')
    expect(result[0].listReferences).toHaveLength(2)
  })

  it('deduplicates case-insensitively by address', () => {
    const tokensByList = new Map([
      ['listA', [makeToken('0xABC', 'provA/listA')]],
      ['listB', [makeToken('0xabc', 'provB/listB')]],
    ])
    const result = deduplicateTokens(tokensByList, new Set(['listA', 'listB']), '1')
    expect(result).toHaveLength(1)
    expect(result[0].listReferences).toHaveLength(2)
  })

  it('returns empty array when no lists are enabled', () => {
    const tokensByList = new Map([
      ['listA', [makeToken('0xabc', 'provA/listA')]],
    ])
    const result = deduplicateTokens(tokensByList, new Set(), '1')
    expect(result).toHaveLength(0)
  })

  it('returns empty array when tokensByList is empty', () => {
    const result = deduplicateTokens(new Map(), new Set(['listA']), '1')
    expect(result).toHaveLength(0)
  })

  it('handles multiple chains without cross-contamination', () => {
    const tokensByList = new Map([
      [
        'listA',
        [
          makeToken('0xabc', 'provA/listA', { chainId: 1 }),
          makeToken('0xabc', 'provA/listA', { chainId: 137 }),
        ],
      ],
    ])
    const chain1 = deduplicateTokens(tokensByList, new Set(['listA']), '1')
    const chain137 = deduplicateTokens(tokensByList, new Set(['listA']), '137')
    expect(chain1).toHaveLength(1)
    expect(chain137).toHaveLength(1)
    expect(chain1[0].chainId).toBe(1)
    expect(chain137[0].chainId).toBe(137)
  })

  it('prepends imageUriPrefix when provided', () => {
    const tokensByList = new Map([
      ['listA', [makeToken('0xabc', 'provA/listA')]],
    ])
    const result = deduplicateTokens(tokensByList, new Set(['listA']), '1', 'https://api.example.com')
    expect(result[0].listReferences![0].imageUri).toBe('https://api.example.com/image/1/0xabc')
  })
})
