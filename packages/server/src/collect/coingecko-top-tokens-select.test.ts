import { describe, expect, it } from 'vitest'

import { resolvePlatform } from './coingecko-platforms'
import {
  allChainsFilled,
  parseCoinPlatforms,
  parseMarketCoin,
  parseMarketPage,
  parseTokenListDetails,
  selectTopTokens,
  type CoinPlatforms,
  type MarketCoin,
} from './coingecko-top-tokens-select'

const ethereum = resolvePlatform('ethereum', 1)!
const bnb = resolvePlatform('binance-smart-chain', 56)!

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`

const coin = (id: string, overrides: Partial<MarketCoin> = {}): MarketCoin => ({
  id,
  symbol: id.slice(0, 4),
  name: `Coin ${id}`,
  image: `https://assets.example.test/${id}.png`,
  ...overrides,
})

describe('parseMarketCoin', () => {
  it('reads a recorded /coins/markets row', () => {
    const row = {
      id: 'usd-coin',
      symbol: 'usdc',
      name: 'USDC',
      image: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png',
      current_price: 1,
      market_cap: 76000000000,
      market_cap_rank: 7,
    }
    expect(parseMarketCoin(row)).toEqual({
      id: 'usd-coin',
      symbol: 'usdc',
      name: 'USDC',
      image: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png',
    })
  })

  it('keeps a coin with no logo, as null', () => {
    expect(parseMarketCoin({ id: 'a', symbol: 'a', name: 'A', image: '' })?.image).toBeNull()
    expect(parseMarketCoin({ id: 'a', symbol: 'a', name: 'A' })?.image).toBeNull()
  })

  it.each([
    null,
    'text',
    [],
    { id: 'a', symbol: 'a' },
    { id: 1, symbol: 'a', name: 'A' },
    { id: '', symbol: 'a', name: 'A' },
  ])('rejects %o', (row) => {
    expect(parseMarketCoin(row)).toBeNull()
  })
})

describe('parseMarketPage', () => {
  it('drops unreadable rows and treats a non-array as empty', () => {
    expect(parseMarketPage([{ id: 'a', symbol: 'a', name: 'A' }, null])).toHaveLength(1)
    expect(parseMarketPage({ status: { error_code: 429 } })).toEqual([])
  })
})

describe('parseCoinPlatforms', () => {
  it('reads addresses by platform and skips rows without platforms', () => {
    const parsed = parseCoinPlatforms([
      { id: 'usd-coin', symbol: 'usdc', name: 'USDC', platforms: { ethereum: address(1), solana: address(2), odd: 5 } },
      { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', platforms: {} },
      { id: 'no-platforms' },
      { id: 'array-platforms', platforms: [] },
      { platforms: {} },
      null,
    ])
    expect([...parsed.keys()]).toEqual(['usd-coin', 'bitcoin'])
    expect(parsed.get('usd-coin')).toEqual({ ethereum: address(1), solana: address(2) })
  })

  it('treats a non-array as empty', () => {
    expect(parseCoinPlatforms({ status: {} }).size).toBe(0)
  })
})

describe('parseTokenListDetails', () => {
  it('reads decimals and logo by lowercase address', () => {
    const details = parseTokenListDetails({
      name: 'CoinGecko',
      tokens: [
        { chainId: 1, address: '0xABCDEF0000000000000000000000000000000001', decimals: 6, logoURI: 'https://l/1.png' },
        { chainId: 1, address: address(2), decimals: 18 },
        { chainId: 1, address: address(3), decimals: 1.5 },
        { chainId: 1, address: address(4), decimals: -1 },
        { chainId: 1, address: address(5), decimals: '6' },
        { chainId: 1, decimals: 6 },
        null,
      ],
    })
    expect([...details.keys()]).toEqual(['0xabcdef0000000000000000000000000000000001', address(2)])
    expect(details.get(address(2))).toEqual({ decimals: 18, logoURI: null })
  })

  it.each([null, [], { tokens: 'none' }, {}])('is empty for %o', (raw) => {
    expect(parseTokenListDetails(raw).size).toBe(0)
  })
})

describe('selectTopTokens', () => {
  const rankedCoins = [coin('big'), coin('native'), coin('mid'), coin('twin'), coin('small'), coin('bad')]
  const platformsByCoin = new Map<string, CoinPlatforms>([
    ['big', { ethereum: address(1), 'binance-smart-chain': address(11) }],
    ['native', {}],
    ['mid', { ethereum: address(2) }],
    ['twin', { ethereum: address(2) }],
    ['small', { ethereum: address(3) }],
    ['bad', { ethereum: 'not-an-address' }],
  ])
  const base = {
    rankedCoins,
    platformsByCoin,
    platformId: 'ethereum',
    platform: ethereum,
    details: new Map(),
    limit: 10,
  }

  it('keeps market-capitalisation order, skipping coins with no or invalid address and repeats', () => {
    const tokens = selectTopTokens(base)

    expect(tokens.map((token) => token.coinId)).toEqual(['big', 'mid', 'small'])
    expect(tokens.map((token) => token.orderIdx)).toEqual([0, 1, 2])
    expect(tokens[0]!.address).toBe(address(1))
  })

  it('keeps only the larger of two coins on one address', () => {
    expect(selectTopTokens(base).some((token) => token.coinId === 'twin')).toBe(false)
  })

  it('stops at the limit', () => {
    expect(selectTopTokens({ ...base, limit: 2 }).map((token) => token.coinId)).toEqual(['big', 'mid'])
  })

  it('reads the platform it is asked for', () => {
    const tokens = selectTopTokens({ ...base, platformId: 'binance-smart-chain', platform: bnb })
    expect(tokens.map((token) => token.address)).toEqual([address(11)])
  })

  it('takes decimals from the token list, and 0 when the token is missing there', () => {
    const details = new Map([[address(1), { decimals: 6, logoURI: null }]])
    const tokens = selectTopTokens({ ...base, details })

    expect(tokens.map((token) => token.decimals)).toEqual([6, 0, 0])
  })

  it('takes the logo from the market feed, then the token list, then none', () => {
    const coins = [coin('a', { image: null }), coin('b', { image: null }), coin('c')]
    const platforms = new Map<string, CoinPlatforms>([
      ['a', { ethereum: address(1) }],
      ['b', { ethereum: address(2) }],
      ['c', { ethereum: address(3) }],
    ])
    const details = new Map([[address(1), { decimals: 18, logoURI: 'https://list.example.test/a.png' }]])

    const tokens = selectTopTokens({ ...base, rankedCoins: coins, platformsByCoin: platforms, details })

    expect(tokens.map((token) => token.logoURI)).toEqual([
      'https://list.example.test/a.png',
      null,
      'https://assets.example.test/c.png',
    ])
  })
})

describe('allChainsFilled', () => {
  const rankedCoins = [coin('a'), coin('b'), coin('c')]
  const platformsByCoin = new Map<string, CoinPlatforms>([
    ['a', { ethereum: address(1), 'binance-smart-chain': address(11) }],
    ['b', { ethereum: address(2) }],
    ['c', { ethereum: address(3) }],
  ])
  const chains = [
    { platformId: 'ethereum', platform: ethereum },
    { platformId: 'binance-smart-chain', platform: bnb },
  ]

  it('is true when every chain has the limit', () => {
    expect(allChainsFilled({ rankedCoins, platformsByCoin, chains, limit: 1 })).toBe(true)
  })

  it('is false while any chain is short', () => {
    expect(allChainsFilled({ rankedCoins, platformsByCoin, chains, limit: 2 })).toBe(false)
  })
})
