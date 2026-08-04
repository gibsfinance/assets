import { describe, it, expect } from 'vitest'
import {
  searchTokens,
  scoreTokenMatch,
  SEARCH_RELEVANCE,
  countResults,
  isCacheHit,
  parsePathParams,
  getPopularChains,
} from './token-search'
import type { NetworkInfo, Token } from '../types'

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
// searchTokens
// ---------------------------------------------------------------------------
describe('searchTokens', () => {
  const tokens = [
    makeToken({ name: 'Wrapped Ether', symbol: 'WETH', address: '0xc02aaa' }),
    makeToken({ name: 'USD Coin', symbol: 'USDC', address: '0xa0b869' }),
    makeToken({ name: 'Dai Stablecoin', symbol: 'DAI', address: '0x6b175474' }),
  ]

  it('returns all tokens for empty search', () => {
    expect(searchTokens(tokens, '')).toHaveLength(3)
  })

  it('ignores surrounding whitespace', () => {
    expect(searchTokens(tokens, '   ')).toHaveLength(3)
    expect(searchTokens(tokens, '  dai  ')).toEqual([tokens[2]])
  })

  it('matches on name', () => {
    expect(searchTokens(tokens, 'ether')).toEqual([tokens[0]])
  })

  it('matches on symbol', () => {
    expect(searchTokens(tokens, 'usdc')).toEqual([tokens[1]])
  })

  it('matches on address', () => {
    expect(searchTokens(tokens, '6b175')).toEqual([tokens[2]])
  })

  it('is case-insensitive', () => {
    expect(searchTokens(tokens, 'DAI')).toEqual([tokens[2]])
    expect(searchTokens(tokens, 'dai')).toEqual([tokens[2]])
  })

  it('returns empty for no matches', () => {
    expect(searchTokens(tokens, 'zzz')).toHaveLength(0)
  })

  /*
   * The reason this function ranks at all. Measured against the live Ethereum
   * list, "usdc" matched 160 tokens and USD Coin came back 52nd — behind fifty
   * Curve and Yearn pools whose names merely mention it. Nothing was missing;
   * it was unreachable.
   */
  describe('relevance', () => {
    const usdCoin = makeToken({ name: 'USD Coin', symbol: 'USDC', address: '0xa0b869' })
    const derivatives = [
      makeToken({ name: 'eUSD/USDC', symbol: 'eUSDUSDC', address: '0x111' }),
      makeToken({ name: 'Curve.fi Factory Crypto Pool: ibCHF/USDC', symbol: 'ibCHFUSDC-f', address: '0x222' }),
      makeToken({ name: 'Curve ibAUD-USDC Pool yVault', symbol: 'yvCurve-ibAUD-USDC', address: '0x333' }),
    ]

    it('puts the exact symbol first even when it arrives last', () => {
      expect(searchTokens([...derivatives, usdCoin], 'usdc')[0]).toBe(usdCoin)
    })

    it('keeps every other match, just further down', () => {
      expect(searchTokens([...derivatives, usdCoin], 'usdc')).toHaveLength(4)
    })

    it('ranks a symbol prefix above a symbol that merely contains the term', () => {
      const prefix = makeToken({ name: 'USD Coin Bridged', symbol: 'USDCe', address: '0x444' })
      const contains = makeToken({ name: 'Pool', symbol: 'eUSDUSDC', address: '0x555' })
      expect(searchTokens([contains, prefix], 'usdc')).toEqual([prefix, contains])
    })

    it('ranks an exact symbol above a name that starts with the term', () => {
      const bySymbol = makeToken({ name: 'Something Else', symbol: 'USDC', address: '0x666' })
      const byName = makeToken({ name: 'USDC Vault', symbol: 'VLT', address: '0x777' })
      expect(searchTokens([byName, bySymbol], 'usdc')).toEqual([bySymbol, byName])
    })

    /*
     * Deliberate: a name that *starts with* the term is better evidence than a
     * symbol that merely contains it somewhere. "USDC Vault" is plausibly what
     * was meant; "xUSDCy" almost never is.
     */
    it('ranks a name prefix above a symbol that only contains the term', () => {
      const byNamePrefix = makeToken({ name: 'USDC Vault', symbol: 'VLT', address: '0x777' })
      const bySymbolContains = makeToken({ name: 'Something Else', symbol: 'xUSDCy', address: '0x666' })
      expect(searchTokens([bySymbolContains, byNamePrefix], 'usdc')).toEqual([byNamePrefix, bySymbolContains])
    })

    it('puts a pasted address above everything', () => {
      const pasted = makeToken({ name: 'Obscure', symbol: 'OBS', address: '0xa0b869' })
      const named = makeToken({ name: '0xa0b869 Pool', symbol: 'POOL', address: '0x888' })
      expect(searchTokens([named, pasted], '0xa0b869')[0]).toBe(pasted)
    })

    /*
     * The incoming order is the server's ranking (list ranking → format →
     * version), so it says which provider is trusted for a token. Ties must not
     * disturb it — that is what makes the impostor stay behind the real one.
     */
    it('leaves equally relevant tokens in the order the server sent them', () => {
      const trusted = makeToken({ name: 'USD Coin', symbol: 'USDC', address: '0xreal' })
      const impostor = makeToken({ name: 'USD Coin', symbol: 'USDC', address: '0xfake' })
      expect(searchTokens([trusted, impostor], 'usdc')).toEqual([trusted, impostor])
      expect(searchTokens([impostor, trusted], 'usdc')).toEqual([impostor, trusted])
    })
  })
})

// ---------------------------------------------------------------------------
// scoreTokenMatch
// ---------------------------------------------------------------------------
describe('scoreTokenMatch', () => {
  const token = makeToken({ name: 'USD Coin', symbol: 'USDC', address: '0xa0b869' })

  it.each([
    ['0xa0b869', SEARCH_RELEVANCE.addressExact],
    ['usdc', SEARCH_RELEVANCE.symbolExact],
    ['usd c', SEARCH_RELEVANCE.namePrefix],
    ['usd coin', SEARCH_RELEVANCE.nameExact],
    ['coin', SEARCH_RELEVANCE.nameContains],
    ['a0b8', SEARCH_RELEVANCE.addressContains],
    ['nothing', SEARCH_RELEVANCE.none],
  ])('scores %s as the expected tier', (term, expected) => {
    expect(scoreTokenMatch(token, term)).toBe(expected)
  })

  it('prefers the symbol tier when a term matches both symbol and name', () => {
    const both = makeToken({ name: 'Wrapped USDC Vault', symbol: 'USDCX', address: '0x999' })
    expect(scoreTokenMatch(both, 'usdc')).toBe(SEARCH_RELEVANCE.symbolPrefix)
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
  const makeNetwork = (overrides: Partial<NetworkInfo> = {}): NetworkInfo => ({
    chainId: 1,
    chainIdentifier: 'eip155-1',
    type: 'evm',
    name: 'Ethereum',
    isTestnet: false,
    tokenCount: 5000,
    hasImage: true,
    isEvm: true,
    ...overrides,
  })

  const networks = [
    makeNetwork(),
    makeNetwork({ chainId: 369, chainIdentifier: 'eip155-369', name: 'PulseChain', tokenCount: 2000 }),
    makeNetwork({ chainId: 56, chainIdentifier: 'eip155-56', name: 'BNB Smart Chain', tokenCount: 500 }),
    makeNetwork({
      chainId: 11155111,
      chainIdentifier: 'eip155-11155111',
      name: 'Sepolia Testnet',
      isTestnet: true,
      tokenCount: 50,
    }),
  ]

  it('returns chains sorted by token count', () => {
    const result = getPopularChains(networks)
    expect(result[0].name).toBe('Ethereum')
    expect(result[1].name).toBe('PulseChain')
  })

  it('excludes testnets', () => {
    const result = getPopularChains(networks)
    expect(result.find((c) => c.name.includes('Testnet'))).toBeUndefined()
  })

  it('excludes chains below minTokens threshold', () => {
    const result = getPopularChains(networks, { minTokens: 1000 })
    expect(result).toHaveLength(2) // only Ethereum and PulseChain
  })

  it('respects limit', () => {
    const result = getPopularChains(networks, { limit: 1 })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Ethereum')
  })

  it('handles empty networks', () => {
    expect(getPopularChains([])).toHaveLength(0)
  })

  // Chain id 501 is Columbus testnet under eip155 and Solana under solana. Keying a
  // card on the bare number merged the two: the testnet claimed Solana's token count
  // and both cards navigated to the testnet, so Solana was unreachable from here.
  it('keeps chains that share a numeric id apart', () => {
    const result = getPopularChains([
      makeNetwork({
        chainId: 501,
        chainIdentifier: 'eip155-501',
        name: 'Columbus Test Network',
        isTestnet: true,
        tokenCount: 0,
      }),
      makeNetwork({
        chainId: 501,
        chainIdentifier: 'solana-501',
        type: 'solana',
        name: 'Solana',
        tokenCount: 9633,
        isEvm: false,
      }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ chainId: 'solana-501', name: 'Solana', tokenCount: 9633 })
  })

  // The old rule matched the substring "testnet", which "Columbus Test Network" and
  // "Sepolia" do not contain. isTestnet, resolved once in useMetrics, does.
  it('excludes a testnet whose name never says "testnet"', () => {
    const result = getPopularChains([
      makeNetwork({
        chainId: 502,
        chainIdentifier: 'eip155-502',
        name: 'Columbus Test Network',
        isTestnet: true,
        tokenCount: 5000,
      }),
    ])

    expect(result).toHaveLength(0)
  })

  it('identifies each chain by the identifier the endpoints take', () => {
    const result = getPopularChains(networks)
    expect(result.map((c) => c.chainId)).toEqual(['eip155-1', 'eip155-369', 'eip155-56'])
  })
})
