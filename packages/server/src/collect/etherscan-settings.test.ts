import { describe, expect, it } from 'vitest'
import { COINGECKO_TOP_TOKENS_PROVIDER_KEY, topTokensListKey } from './coingecko-top-tokens-settings'
import { parseChainIds, parseSourceLists, readEtherscanSettings } from './etherscan-settings'

describe('parseSourceLists', () => {
  it('reads provider and provider:prefix entries and trims them', () => {
    expect(parseSourceLists(' coingecko:top-tokens , routescan ')).toEqual([
      { providerKey: 'coingecko', listKeyPrefix: 'top-tokens' },
      { providerKey: 'routescan', listKeyPrefix: '' },
    ])
  })

  it('keeps a colon inside the prefix', () => {
    expect(parseSourceLists('a:b:c')).toEqual([{ providerKey: 'a', listKeyPrefix: 'b:c' }])
  })

  it('refuses etherscan as its own source and drops empty providers', () => {
    expect(parseSourceLists('etherscan:top-tokens,:x,,coingecko')).toEqual([
      { providerKey: 'coingecko', listKeyPrefix: '' },
    ])
  })
})

describe('parseChainIds', () => {
  it('keeps whole positive numbers and drops the rest', () => {
    expect(parseChainIds('1, 137,abc,0,-5,1.5,,8453')).toEqual([1, 137, 8453])
  })
})

describe('readEtherscanSettings', () => {
  it('defaults everything and leaves the key unset', () => {
    expect(readEtherscanSettings({})).toEqual({
      apiKey: undefined,
      callsPerSecond: 3,
      tokensPerChain: 100,
      sourceLists: [
        { providerKey: 'coingecko-top-tokens', listKeyPrefix: 'top-tokens' },
        { providerKey: 'routescan', listKeyPrefix: 'top-tokens' },
      ],
      chainIds: null,
    })
  })

  it('reads every setting', () => {
    expect(
      readEtherscanSettings({
        ETHERSCAN_API_KEY: '  secret  ',
        ETHERSCAN_CALLS_PER_SECOND: '10',
        ETHERSCAN_TOKENS_PER_CHAIN: '25',
        ETHERSCAN_SOURCE_LISTS: 'dexscreener',
        ETHERSCAN_CHAIN_IDS: '1,137',
      }),
    ).toEqual({
      apiKey: 'secret',
      callsPerSecond: 10,
      tokensPerChain: 25,
      sourceLists: [{ providerKey: 'dexscreener', listKeyPrefix: '' }],
      chainIds: [1, 137],
    })
  })

  it('treats a blank key as unset', () => {
    expect(readEtherscanSettings({ ETHERSCAN_API_KEY: '   ' }).apiKey).toBeUndefined()
  })

  it('falls back to defaults for unusable limits and lists, rather than switching the collector off', () => {
    const settings = readEtherscanSettings({
      ETHERSCAN_CALLS_PER_SECOND: '0',
      ETHERSCAN_TOKENS_PER_CHAIN: 'many',
      ETHERSCAN_SOURCE_LISTS: 'etherscan',
      ETHERSCAN_CHAIN_IDS: 'x',
    })
    expect(settings.callsPerSecond).toBe(3)
    expect(settings.tokensPerChain).toBe(100)
    expect(settings.sourceLists).toHaveLength(2)
    expect(settings.chainIds).toBeNull()
  })
})

describe('default source lists', () => {
  const selects = ({ providerKey, listKeyPrefix }: { providerKey: string; listKeyPrefix: string }, listKey: string) =>
    listKey.startsWith(listKeyPrefix) && providerKey !== ''

  it('select the CoinGecko top-tokens collector provider and its per-chain list keys first, then Routescan', () => {
    const { sourceLists } = readEtherscanSettings({})
    expect(sourceLists.map(({ providerKey }) => providerKey)).toEqual([COINGECKO_TOP_TOKENS_PROVIDER_KEY, 'routescan'])
    expect(COINGECKO_TOP_TOKENS_PROVIDER_KEY).toBe('coingecko-top-tokens')
    for (const chainId of [1, 137, 8453]) {
      expect(selects(sourceLists[0], topTokensListKey(chainId))).toBe(true)
      expect(topTokensListKey(chainId)).toBe(`top-tokens-${chainId}`)
    }
  })
})
