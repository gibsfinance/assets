/**
 * Reading rules for LiFi's token catalogue.
 *
 * LiFi carries 17,495 tokens across 71 chains and marks 3,579 of them
 * flagged — its own judgement that a token looks malicious. This service
 * exists to serve token artwork, so handing a flagged token a clean, convincing
 * logo is the worst outcome available here. The verification filter is the
 * security boundary for this module, and every test below treats it that way.
 */
import { describe, it, expect } from 'vitest'
import { parseLifiCatalogue, REQUIRED_VERIFICATION_STATUS, NON_EVM_CHAIN_IDS } from './lifi-parse'

/** One complete, verified entry in LiFi's own response shape. */
const verifiedEntry = (overrides: Record<string, unknown> = {}) => ({
  chainId: 1,
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  logoURI: 'https://example.com/usdc.png',
  verificationStatus: 'verified',
  ...overrides,
})

describe('parseLifiCatalogue — verification is the security boundary', () => {
  it('collects a token whose verification status is verified', () => {
    const raw = { tokens: { '1': [verifiedEntry()] } }
    const result = parseLifiCatalogue(raw)
    expect(result.tokens).toHaveLength(1)
    expect(result.tokens[0]?.symbol).toBe('USDC')
  })

  it('refuses a token LiFi has flagged as malicious, and counts the refusal', () => {
    // Serving artwork for a flagged token is help a scam does not otherwise
    // get. This case must never quietly slip through as a passing token.
    const raw = { tokens: { '1': [verifiedEntry({ verificationStatus: 'flagged' })] } }
    const result = parseLifiCatalogue(raw)
    expect(result.tokens).toHaveLength(0)
    expect(result.rejected[`not ${REQUIRED_VERIFICATION_STATUS}`]).toBe(1)
  })

  it('refuses a token that is merely unverified, because nothing has vouched for it', () => {
    const raw = { tokens: { '1': [verifiedEntry({ verificationStatus: 'unverified' })] } }
    const result = parseLifiCatalogue(raw)
    expect(result.tokens).toHaveLength(0)
    expect(result.rejected[`not ${REQUIRED_VERIFICATION_STATUS}`]).toBe(1)
  })

  it('reads the verification verdict before any other rule, so a flagged and malformed token counts once as not verified', () => {
    // A token that is both flagged and missing an address must be counted
    // under the verification reason, not under "no address". Counting it
    // twice, or under the wrong reason, would hide how many tokens LiFi
    // itself is refusing to vouch for.
    const raw = {
      tokens: {
        '1': [verifiedEntry({ verificationStatus: 'flagged', address: undefined, decimals: 'not a number' })],
      },
    }
    const result = parseLifiCatalogue(raw)
    expect(result.tokens).toHaveLength(0)
    expect(result.rejected).toEqual({ [`not ${REQUIRED_VERIFICATION_STATUS}`]: 1 })
  })

  it('still tallies the underlying reason when a verified token fails a later rule', () => {
    const raw = { tokens: { '1': [verifiedEntry({ decimals: -1 })] } }
    const result = parseLifiCatalogue(raw)
    expect(result.tokens).toHaveLength(0)
    expect(result.rejected['decimals outside 0 to 255']).toBe(1)
  })
})

describe('parseLifiCatalogue — chain-keyed response shape', () => {
  it('reads tokens for several chains in one pass', () => {
    const raw = {
      tokens: {
        '1': [verifiedEntry({ chainId: 1, symbol: 'USDC' })],
        '137': [verifiedEntry({ chainId: 137, symbol: 'WMATIC', address: '0xBBBB' })],
      },
    }
    const result = parseLifiCatalogue(raw)
    expect(result.tokens.map((token) => token.symbol).sort()).toEqual(['USDC', 'WMATIC'])
  })

  it('counts an entry that is not an object, rather than throwing', () => {
    const raw = { tokens: { '1': ['not an object', 42, null] } }
    const result = parseLifiCatalogue(raw)
    expect(result.tokens).toHaveLength(0)
    expect(result.rejected['not an object']).toBe(3)
  })

  it('counts a chain entry that is not a list, rather than throwing', () => {
    const raw = { tokens: { '1': 'this should be an array' } }
    const result = parseLifiCatalogue(raw)
    expect(result.tokens).toHaveLength(0)
    expect(result.rejected['chain entry was not a list']).toBe(1)
  })
})

describe('parseLifiCatalogue — malformed responses yield no tokens instead of throwing', () => {
  it('returns no tokens when the response is not an object at all', () => {
    expect(parseLifiCatalogue(null)).toEqual({ tokens: [], rejected: {} })
    expect(parseLifiCatalogue('a string')).toEqual({ tokens: [], rejected: {} })
    expect(parseLifiCatalogue(42)).toEqual({ tokens: [], rejected: {} })
    expect(parseLifiCatalogue([1, 2, 3])).toEqual({ tokens: [], rejected: {} })
  })

  it('returns no tokens when the response has no tokens field', () => {
    expect(parseLifiCatalogue({})).toEqual({ tokens: [], rejected: {} })
  })

  it('returns no tokens when the tokens field is not itself an object', () => {
    expect(parseLifiCatalogue({ tokens: 'not an object' })).toEqual({ tokens: [], rejected: {} })
    expect(parseLifiCatalogue({ tokens: null })).toEqual({ tokens: [], rejected: {} })
  })
})

describe("parseLifiCatalogue — LiFi's invented ids for non-Ethereum-Virtual-Machine chains", () => {
  it('skips every id in the non-Ethereum-Virtual-Machine set, one chain at a time', () => {
    // LiFi numbers Solana, Bitcoin and Sui with ids it invented so they fit one
    // integer field. Two identifiers that merely differ are not thereby
    // related: nothing here asserts a pairing between one of these numbers and
    // a real coin-type identifier, so the entries are skipped outright rather
    // than mapped onto some other chain's tokens.
    for (const nonEvmChainId of NON_EVM_CHAIN_IDS) {
      const raw = { tokens: { [String(nonEvmChainId)]: [verifiedEntry({ chainId: nonEvmChainId })] } }
      const result = parseLifiCatalogue(raw)
      expect(result.tokens).toHaveLength(0)
      expect(result.rejected['not an Ethereum Virtual Machine chain']).toBe(1)
    }
  })

  it('keeps an ordinary Ethereum Virtual Machine chain id that merely happens to be large', () => {
    const raw = { tokens: { '42161': [verifiedEntry({ chainId: 42161 })] } }
    const result = parseLifiCatalogue(raw)
    expect(result.tokens).toHaveLength(1)
    expect(result.tokens[0]?.chainId).toBe(42161)
  })
})
