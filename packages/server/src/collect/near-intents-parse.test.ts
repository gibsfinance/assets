/**
 * Reading the asset list NEAR Intents will settle.
 *
 * The feed is small and unusual: it names chains by short code rather than by
 * id, carries no artwork at all, and carries no names either. Each of those is
 * a chance to invent something the source never said, so the tests below are
 * mostly about what the parser refuses to make up.
 */
import { describe, it, expect } from 'vitest'
import { parseNearIntentsCatalogue, CHAIN_ID_BY_CODE } from './near-intents-parse'

/** One asset in the shape the live feed returns. */
const asset = (overrides: Record<string, unknown> = {}) => ({
  assetId: 'nep141:example',
  blockchain: 'eth',
  symbol: 'USDT',
  decimals: 6,
  contractAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  price: 1.0,
  priceUpdatedAt: '2026-09-09T01:50:00.457Z',
  coingeckoId: 'tether',
  ...overrides,
})

describe('CHAIN_ID_BY_CODE', () => {
  it('gives every code its own chain, so no two codes collect into one list', () => {
    // A repeated id would quietly merge two chains' tokens into one list and
    // file each token under a chain it is not on.
    const ids = Object.values(CHAIN_ID_BY_CODE)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('maps only to whole positive chain numbers', () => {
    for (const [code, chainId] of Object.entries(CHAIN_ID_BY_CODE)) {
      expect(Number.isInteger(chainId), `${code} maps to a whole number`).toBe(true)
      expect(chainId, `${code} maps to a positive number`).toBeGreaterThan(0)
    }
  })

  it('holds the handful of chain identities the module claims', () => {
    // Each was read from the chain registry rather than recalled. Pinning a few
    // here means a careless edit to the table has to argue with a test. Polygon
    // is the one worth naming: "pol" resolving to Polygon rather than to Polygon
    // zero-knowledge Ethereum Virtual Machine is a fact to look up, not to infer.
    expect(CHAIN_ID_BY_CODE.eth).toBe(1)
    expect(CHAIN_ID_BY_CODE.pol).toBe(137)
    expect(CHAIN_ID_BY_CODE.base).toBe(8453)
    expect(CHAIN_ID_BY_CODE.bera).toBe(80094)
  })
})

describe('parseNearIntentsCatalogue', () => {
  it('reads a complete asset on a mapped chain', () => {
    const { tokens } = parseNearIntentsCatalogue([asset()])
    expect(tokens).toEqual([
      {
        chainId: 1,
        address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        name: 'USDT',
        symbol: 'USDT',
        decimals: 6,
        logoURI: null,
      },
    ])
  })

  it('calls a token by its symbol, because the feed carries no names', () => {
    // Stated outright rather than left as a blank column for a reader to
    // explain. Every asset in this feed has a symbol and none has a name.
    const { tokens } = parseNearIntentsCatalogue([asset({ symbol: 'WBTC' })])
    expect(tokens[0].name).toBe('WBTC')
    expect(tokens[0].symbol).toBe('WBTC')
  })

  it('never carries artwork, because the feed has none to carry', () => {
    // The feed does carry a CoinGecko identifier. Resolving a logo through it
    // would mean treating two identifiers as a pair because they share a
    // record, which is how the wrong token's picture reaches a screen.
    const { tokens } = parseNearIntentsCatalogue([asset({ coingeckoId: 'tether' })])
    expect(tokens[0].logoURI).toBeNull()
  })

  it('skips a chain it has no verified identity for, rather than guessing one', () => {
    // Most of this feed is not an Ethereum Virtual Machine chain: near, sol,
    // aptos, starknet, btc, tron and the rest. Inventing an Ethereum chain id
    // for any of them would create a network row for a chain that does not
    // exist and file real tokens under it.
    const { tokens, rejected } = parseNearIntentsCatalogue([
      asset({ blockchain: 'near' }),
      asset({ blockchain: 'sol' }),
      asset({ blockchain: 'eth' }),
    ])
    expect(tokens).toHaveLength(1)
    expect(tokens[0].chainId).toBe(1)
    expect(rejected['chain not mapped to an Ethereum Virtual Machine id']).toBe(2)
  })

  it('treats a missing blockchain code as unmapped rather than as a chain', () => {
    const { tokens, rejected } = parseNearIntentsCatalogue([asset({ blockchain: undefined })])
    expect(tokens).toHaveLength(0)
    expect(rejected['chain not mapped to an Ethereum Virtual Machine id']).toBe(1)
  })

  it('skips a native coin instead of filing it under the all-zero address', () => {
    // An asset with no contract address is the chain's native coin. The
    // all-zero convention is LiFi's and this service's, not NEAR Intents' —
    // adopting it here would be this module asserting an identity its source
    // never stated.
    const { tokens, rejected } = parseNearIntentsCatalogue([
      asset({ contractAddress: undefined, symbol: 'ETH' }),
      asset({ contractAddress: null, symbol: 'BNB', blockchain: 'bsc' }),
    ])
    expect(tokens).toHaveLength(0)
    expect(rejected['native coin, no contract address']).toBe(2)
  })

  it('keeps a token that declares zero decimals exactly as it declared them', () => {
    // A rewrite to eighteen here is a factor of ten to the eighteenth applied
    // to every amount downstream.
    const { tokens } = parseNearIntentsCatalogue([asset({ decimals: 0 })])
    expect(tokens[0].decimals).toBe(0)
  })

  it('keeps a decimals count above eighteen, which this feed really carries', () => {
    // Wrapped NEAR declares 24. A parser that assumed eighteen was the ceiling
    // would drop it or mangle it.
    const { tokens } = parseNearIntentsCatalogue([asset({ decimals: 24, symbol: 'wNEAR' })])
    expect(tokens[0].decimals).toBe(24)
  })

  it('refuses an asset whose decimals cannot be read, rather than defaulting', () => {
    const { tokens, rejected } = parseNearIntentsCatalogue([
      asset({ decimals: 'not a number' }),
      asset({ decimals: -1 }),
    ])
    expect(tokens).toHaveLength(0)
    expect(rejected['decimals outside 0 to 255']).toBe(2)
  })

  it('refuses an asset with no symbol, which would leave it with no name either', () => {
    const { tokens, rejected } = parseNearIntentsCatalogue([asset({ symbol: '   ' })])
    expect(tokens).toHaveLength(0)
    expect(rejected['no symbol']).toBe(1)
  })

  it('counts an entry that is not an object rather than throwing on it', () => {
    const { tokens, rejected } = parseNearIntentsCatalogue([null, 'a string', 42, asset()])
    expect(tokens).toHaveLength(1)
    expect(rejected['not an object']).toBe(3)
  })

  it('answers empty for a body that is not a list', () => {
    // The endpoint could answer with an error object on a bad day. Reading that
    // as a catalogue must not throw inside a collection run.
    for (const body of [null, undefined, {}, 'nope', { message: 'Not Found' }]) {
      expect(parseNearIntentsCatalogue(body)).toEqual({ tokens: [], rejected: {} })
    }
  })

  it('reads several chains in one pass and keeps each token on its own chain', () => {
    const { tokens } = parseNearIntentsCatalogue([
      asset({ blockchain: 'eth', symbol: 'A' }),
      asset({ blockchain: 'base', symbol: 'B' }),
      asset({ blockchain: 'arb', symbol: 'C' }),
    ])
    expect(tokens.map((token) => [token.symbol, token.chainId])).toEqual([
      ['A', 1],
      ['B', 8453],
      ['C', 42161],
    ])
  })
})
