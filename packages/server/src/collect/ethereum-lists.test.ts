import { describe, it, expect } from 'vitest'
import { NETWORK_MAPPING, parseTokenRecord, resolveChainId, resolveLogo } from './ethereum-lists-parse'

/**
 * The slug -> chain-id map is transcribed by hand from the source repository's
 * Main.kt. A single wrong number would silently file every token in that folder
 * onto the wrong chain, so the exact map is locked here.
 */
describe('resolveChainId', () => {
  it('resolves each mapped slug to its authoritative chain id', () => {
    const expected: Record<string, number> = {
      eth: 1,
      esn: 2,
      ubq: 8,
      rsk: 30,
      bsc: 56,
      etc: 61,
      ella: 64,
      sonic: 146,
      vc: 207,
      zks: 324,
      arb: 42161,
      avax: 43114,
    }
    expect(NETWORK_MAPPING).toEqual(expected)
    for (const [slug, chainId] of Object.entries(expected)) {
      expect(resolveChainId(slug)).toEqual({ status: 'included', chainId })
    }
  })

  it('excludes the dead testnet folders whose chains no longer exist', () => {
    // Ropsten, Rinkeby, Goerli, and Kovan are shut down; ingesting them would create
    // dead networks, so they must resolve to 'excluded' rather than a chain id.
    for (const slug of ['rop', 'rin', 'gor', 'kov']) {
      expect(resolveChainId(slug)).toEqual({ status: 'excluded' })
    }
  })

  it('reports an unmapped, non-dead folder as unknown', () => {
    // A folder that is neither mapped nor a known dead testnet is a genuine unknown,
    // kept distinct from 'excluded' so the collector can surface it instead of ingesting it.
    expect(resolveChainId('does-not-exist')).toEqual({ status: 'unknown' })
  })
})

/**
 * The source documents `logo` as a plain string but ships it as an object in
 * practice, so both shapes must resolve; a token with no logo must still ingest
 * (empty string), never be dropped for lacking one.
 */
describe('resolveLogo', () => {
  it('reads the src of an object logo, the common on-disk shape', () => {
    expect(resolveLogo({ src: 'https://example.com/a.png', width: '32', height: '32' })).toBe(
      'https://example.com/a.png',
    )
  })

  it('accepts a plain string logo, the documented shape', () => {
    expect(resolveLogo('https://example.com/b.png')).toBe('https://example.com/b.png')
  })

  it('yields an empty string when the logo is missing or unusable', () => {
    // No logo is a valid state — the token still ingests, just without an image.
    expect(resolveLogo(undefined)).toBe('')
    expect(resolveLogo(null)).toBe('')
    expect(resolveLogo('')).toBe('')
    expect(resolveLogo('   ')).toBe('')
    expect(resolveLogo({ src: '' })).toBe('')
    expect(resolveLogo({ width: 32 })).toBe('')
  })
})

describe('parseTokenRecord', () => {
  const valid = {
    symbol: 'NANI',
    name: 'NANI',
    address: '0x00000000000007C8612bA63Df8DdEfD9E6077c97',
    decimals: 18,
  }

  it('parses a well-formed record into a chain-tagged token entry', () => {
    expect(parseTokenRecord({ ...valid, logo: { src: 'https://example.com/n.png' } }, 1)).toEqual({
      chainId: 1,
      address: '0x00000000000007C8612bA63Df8DdEfD9E6077c97',
      name: 'NANI',
      symbol: 'NANI',
      decimals: 18,
      logoURI: 'https://example.com/n.png',
    })
  })

  it('rejects a record carrying a non-empty redFlags array', () => {
    // redFlags marks scam or suspicious contracts in the source; such tokens must
    // never be ingested no matter how complete the rest of their metadata is.
    expect(parseTokenRecord({ ...valid, redFlags: ['SCAM'] }, 1)).toBeNull()
  })

  it('ignores an empty redFlags array', () => {
    // An empty array carries no warning, so it must not by itself disqualify a token.
    expect(parseTokenRecord({ ...valid, redFlags: [] }, 1)).not.toBeNull()
  })

  it('accepts decimals of zero but rejects string or absent decimals', () => {
    // decimals: 0 is legitimate (some tokens have none); the source always stores a
    // number, so a string is malformed input and the field being absent is invalid.
    expect(parseTokenRecord({ ...valid, decimals: 0 }, 1)?.decimals).toBe(0)
    expect(parseTokenRecord({ ...valid, decimals: '18' }, 1)).toBeNull()
    expect(parseTokenRecord({ symbol: 'X', name: 'X', address: valid.address }, 1)).toBeNull()
    expect(parseTokenRecord({ ...valid, decimals: Number.NaN }, 1)).toBeNull()
  })

  it('rejects a record missing symbol, name, or address', () => {
    // These three fields are mandatory in the schema; a token without any of them
    // cannot be served, so it is skipped rather than stored half-formed.
    expect(parseTokenRecord({ ...valid, symbol: '' }, 1)).toBeNull()
    expect(parseTokenRecord({ ...valid, name: '   ' }, 1)).toBeNull()
    expect(parseTokenRecord({ symbol: 'X', name: 'X', decimals: 18 }, 1)).toBeNull()
  })

  it('rejects non-object input outright', () => {
    // Token files are external input; a non-object (bad JSON, a bare value) is a skip.
    expect(parseTokenRecord(null, 1)).toBeNull()
    expect(parseTokenRecord('nope', 1)).toBeNull()
    expect(parseTokenRecord(42, 1)).toBeNull()
  })

  it('defaults logoURI to an empty string when no logo is present', () => {
    // A token with no logo still ingests; the empty string signals no image.
    expect(parseTokenRecord(valid, 1)?.logoURI).toBe('')
  })
})
