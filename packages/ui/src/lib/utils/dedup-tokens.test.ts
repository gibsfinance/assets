import { describe, it, expect } from 'vitest'
import type { Token, TokenListReference } from '../types'

/**
 * Pure extraction of the deduplication logic from StudioBrowser.
 * Mirrors the useMemo in StudioBrowser that builds filteredTokens
 * from tokensByList + enabledLists for a given selectedChainId.
 */
function deduplicateTokens(
  tokensByList: Map<string, Token[]>,
  enabledLists: Set<string>,
  selectedChainId: string,
): Token[] {
  const tokenMap = new Map<string, Token>()

  const addToken = (token: Token) => {
    if (token.chainId.toString() !== selectedChainId) return
    if (!token.hasIcon) return
    const key = `${token.chainId}-${token.address.toLowerCase()}`
    const ref: TokenListReference = {
      sourceList: token.sourceList,
      imageUri: `/image/${token.chainId}/${token.address}`,
      imageFormat: '',
    }
    const existing = tokenMap.get(key)
    if (existing) {
      if (!existing.listReferences) {
        existing.listReferences = [
          {
            sourceList: existing.sourceList,
            imageUri: `/image/${existing.chainId}/${existing.address}`,
            imageFormat: '',
          },
        ]
      }
      if (!existing.listReferences.some((r) => r.sourceList === ref.sourceList)) {
        existing.listReferences.push(ref)
      }
    } else {
      tokenMap.set(key, { ...token, listReferences: [ref] })
    }
  }

  // Non-bridge lists first
  for (const [listKey, tokens] of tokensByList.entries()) {
    if (!enabledLists.has(listKey) || listKey.includes('bridge')) continue
    for (const token of tokens) addToken(token)
  }

  // Bridge lists second
  for (const [listKey, tokens] of tokensByList.entries()) {
    if (!enabledLists.has(listKey) || !listKey.includes('bridge')) continue
    for (const token of tokens) addToken(token)
  }

  return Array.from(tokenMap.values())
}

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
})
