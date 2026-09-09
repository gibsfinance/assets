import { describe, it, expect } from 'vitest'
import { parseRelayCatalogue } from './relay-parse'

/**
 * Relay's currency feed groups the same token across chains inside one array. A
 * request for the whole catalogue returns groups like this - two chains sharing
 * one United States Dollar Coin entry.
 */
const usdCoinGroup = [
  {
    vmType: 'evm',
    chainId: 1,
    address: '0xA0b86991c6218b36c1d19D4A2e9Eb0cE3606eB48',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    metadata: { verified: true, logoURI: 'https://assets.relay.link/icons/1/usdc.png' },
  },
  {
    vmType: 'evm',
    chainId: 10,
    address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    metadata: { verified: true, logoURI: 'https://assets.relay.link/icons/1/usdc.png' },
  },
]

describe('parseRelayCatalogue', () => {
  it('reads one token per chain out of a multi-chain group', () => {
    const result = parseRelayCatalogue([usdCoinGroup])

    expect(result.tokens).toHaveLength(2)
    expect(result.tokens.map((token) => token.chainId)).toEqual([1, 10])
    expect(result.tokens.every((token) => token.symbol === 'USDC')).toBe(true)
  })

  it('reads a flat array of tokens the same way, since a group is not always wrapped in one', () => {
    const daiToken = {
      vmType: 'evm',
      chainId: 1,
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0f',
      name: 'Dai Stablecoin',
      symbol: 'DAI',
      decimals: 18,
      metadata: { verified: true, logoURI: 'https://assets.relay.link/icons/1/dai.png' },
    }

    const result = parseRelayCatalogue([daiToken])

    expect(result.tokens).toHaveLength(1)
    expect(result.tokens[0]?.symbol).toBe('DAI')
  })

  it('refuses a chain id that is not on the Ethereum Virtual Machine, even one that looks like a plain chain id', () => {
    // Relay reports Tron with the chain id 728126428. The number reads like an
    // ordinary Ethereum chain id, but Tron is not an Ethereum Virtual Machine
    // chain, and the database already refuses this exact id by name. This filter
    // is what stops the collector from making that mistake before the database
    // ever sees the value.
    const tronUsdt = {
      vmType: 'tvm',
      chainId: 728126428,
      address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      name: 'Tether USD',
      symbol: 'USDT',
      decimals: 6,
      metadata: { verified: true, logoURI: 'https://assets.relay.link/icons/tron/usdt.png' },
    }

    const result = parseRelayCatalogue([tronUsdt])

    expect(result.tokens).toHaveLength(0)
    expect(result.rejected).toEqual({ 'not an Ethereum Virtual Machine chain': 1 })
  })

  it('refuses a token Relay has not verified, including one with no metadata at all', () => {
    // The unfiltered feed answers with spam like this beside real tokens such as
    // Tether. Absent metadata is not the same as `verified: false`, but it is
    // still not a vouch, so both refuse the same way.
    const tetherToken = {
      vmType: 'evm',
      chainId: 1,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec',
      name: 'Tether USD',
      symbol: 'USDT',
      decimals: 6,
      metadata: { verified: true, logoURI: 'https://assets.relay.link/icons/1/usdt.png' },
    }
    const spamWithFalseMetadata = {
      vmType: 'evm',
      chainId: 1,
      address: '0x1111111111111111111111111111111111111a',
      name: 'Infinite Monkey: POAYFPKWSKCHB',
      symbol: 'InfiniteMonkey',
      decimals: 0,
      metadata: { logoURI: '', verified: false },
    }
    const spamWithNoMetadata = {
      vmType: 'evm',
      chainId: 1,
      address: '0x2222222222222222222222222222222222222b',
      name: 'No Metadata Token',
      symbol: 'NOMETA',
      decimals: 18,
    }

    const result = parseRelayCatalogue([tetherToken, spamWithFalseMetadata, spamWithNoMetadata])

    expect(result.tokens.map((token) => token.symbol)).toEqual(['USDT'])
    expect(result.rejected).toEqual({ 'not verified': 2 })
  })

  it('reads the logo from metadata.logoURI, not a top-level field, turning an empty one into null', () => {
    const tokenWithTopLevelDecoy = {
      vmType: 'evm',
      chainId: 1,
      address: '0x3333333333333333333333333333333333333c',
      name: 'Token A',
      symbol: 'TKA',
      decimals: 18,
      // A top-level logoURI a careless reader might reach for instead.
      logoURI: 'https://example.com/wrong-logo.png',
      metadata: { verified: true, logoURI: 'https://assets.relay.link/icons/1/tka.png' },
    }
    const tokenWithEmptyLogo = {
      vmType: 'evm',
      chainId: 1,
      address: '0x4444444444444444444444444444444444444d',
      name: 'Token B',
      symbol: 'TKB',
      decimals: 18,
      metadata: { verified: true, logoURI: '' },
    }

    const result = parseRelayCatalogue([tokenWithTopLevelDecoy, tokenWithEmptyLogo])

    expect(result.tokens.find((token) => token.symbol === 'TKA')?.logoURI).toBe(
      'https://assets.relay.link/icons/1/tka.png',
    )
    expect(result.tokens.find((token) => token.symbol === 'TKB')?.logoURI).toBeNull()
  })

  it('yields no tokens, without throwing, when the response is not an array', () => {
    expect(parseRelayCatalogue({})).toEqual({ tokens: [], rejected: {} })
    expect(parseRelayCatalogue(null)).toEqual({ tokens: [], rejected: {} })
    expect(parseRelayCatalogue('not an array')).toEqual({ tokens: [], rejected: {} })
  })

  it('counts refusals by reason, across every reason a response can trigger at once', () => {
    const raw = [
      null, // not a record
      42, // not a record
      { vmType: 'tvm', chainId: 728126428, metadata: { verified: true } }, // wrong virtual machine
      { vmType: 'evm', chainId: 1, metadata: { verified: false } }, // not verified
      // Verified and on the right virtual machine, but unreadable as a token: no address.
      { vmType: 'evm', chainId: 1, metadata: { verified: true }, name: 'No Address', symbol: 'NOADDR', decimals: 18 },
    ]

    const result = parseRelayCatalogue(raw)

    expect(result.tokens).toHaveLength(0)
    expect(result.rejected).toEqual({
      'not an object': 2,
      'not an Ethereum Virtual Machine chain': 1,
      'not verified': 1,
      'no address': 1,
    })
  })
})
