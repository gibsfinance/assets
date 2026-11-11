import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MARKET_PAGE_LIMIT,
  DEFAULT_TOKENS_PER_CHAIN,
  DEFAULT_TOP_TOKEN_CHAIN_IDS,
  parseChainIds,
  parsePositiveInteger,
  readCoinGeckoTopTokensSettings,
  resolvePlan,
} from './coingecko-top-tokens-settings'

describe('resolvePlan', () => {
  it('is keyless without a key, whatever the plan says', () => {
    expect(resolvePlan({})).toBe('keyless')
    expect(resolvePlan({ COINGECKO_API_PLAN: 'demo' })).toBe('keyless')
  })

  it('treats a key with no stated plan as a Pro key', () => {
    expect(resolvePlan({ COINGECKO_API_KEY: 'k' })).toBe('pro')
    expect(resolvePlan({ COINGECKO_API_KEY: 'k', COINGECKO_API_PLAN: 'analyst' })).toBe('pro')
  })

  it('reads demo in any letter case', () => {
    expect(resolvePlan({ COINGECKO_API_KEY: 'k', COINGECKO_API_PLAN: 'Demo' })).toBe('demo')
  })
})

describe('parsePositiveInteger', () => {
  it('accepts whole numbers of at least one', () => {
    expect(parsePositiveInteger('250', 7)).toBe(250)
    expect(parsePositiveInteger('1', 7)).toBe(1)
  })

  it.each([undefined, '', '0', '-3', '1.5', 'many'])('falls back for %o', (value) => {
    expect(parsePositiveInteger(value, 7)).toBe(7)
  })
})

describe('parseChainIds', () => {
  it('uses the defaults when unset or empty', () => {
    expect(parseChainIds(undefined)).toEqual([...DEFAULT_TOP_TOKEN_CHAIN_IDS])
    expect(parseChainIds('')).toEqual([...DEFAULT_TOP_TOKEN_CHAIN_IDS])
  })

  it('trims, drops bad entries and repeats', () => {
    expect(parseChainIds(' 1, 56 ,x,0,56,-4,1.5')).toEqual([1, 56])
  })

  it('uses the defaults when nothing valid is left', () => {
    expect(parseChainIds('x,0')).toEqual([...DEFAULT_TOP_TOKEN_CHAIN_IDS])
  })

  it('returns a copy, so a caller cannot change the defaults', () => {
    parseChainIds(undefined).push(999)
    expect(DEFAULT_TOP_TOKEN_CHAIN_IDS).not.toContain(999)
  })

  it('covers PulseChain and the chains the retired Etherscan collector scraped', () => {
    expect(DEFAULT_TOP_TOKEN_CHAIN_IDS).toEqual(expect.arrayContaining([1, 56, 137, 42161, 10, 8453, 369]))
  })
})

describe('readCoinGeckoTopTokensSettings', () => {
  it('uses the public host, no header and the slow spacing without a key', () => {
    const settings = readCoinGeckoTopTokensSettings({})
    expect(settings).toMatchObject({
      plan: 'keyless',
      baseUrl: 'https://api.coingecko.com/api/v3',
      headers: {},
      minimumIntervalMs: 12_000,
      tokensPerChain: DEFAULT_TOKENS_PER_CHAIN,
      marketPageLimit: DEFAULT_MARKET_PAGE_LIMIT,
    })
  })

  it('sends a Demo key in the Demo header to the public host', () => {
    const settings = readCoinGeckoTopTokensSettings({ COINGECKO_API_KEY: 'abc', COINGECKO_API_PLAN: 'demo' })
    expect(settings.baseUrl).toBe('https://api.coingecko.com/api/v3')
    expect(settings.headers).toEqual({ 'x-cg-demo-api-key': 'abc' })
    expect(settings.minimumIntervalMs).toBe(700)
  })

  it('sends a Pro key in the Pro header to the Pro host', () => {
    const settings = readCoinGeckoTopTokensSettings({ COINGECKO_API_KEY: 'abc' })
    expect(settings.baseUrl).toBe('https://pro-api.coingecko.com/api/v3')
    expect(settings.headers).toEqual({ 'x-cg-pro-api-key': 'abc' })
    expect(settings.minimumIntervalMs).toBe(150)
  })

  it('reads the count, pages, chains and spacing overrides', () => {
    const settings = readCoinGeckoTopTokensSettings({
      COINGECKO_TOP_TOKENS_COUNT: '25',
      COINGECKO_TOP_TOKENS_MARKET_PAGES: '3',
      COINGECKO_TOP_TOKENS_CHAINS: '1,369',
      COINGECKO_TOP_TOKENS_INTERVAL_MS: '50',
    })
    expect(settings).toMatchObject({
      tokensPerChain: 25,
      marketPageLimit: 3,
      chainIds: [1, 369],
      minimumIntervalMs: 50,
    })
  })
})
