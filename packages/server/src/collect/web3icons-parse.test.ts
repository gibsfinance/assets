import { describe, it, expect } from 'vitest'
import {
  hasUsableCaip2Id,
  hasBrandedVariant,
  toGibsChainId,
  brandedIconUrl,
  parseNetworkEntries,
} from './web3icons-parse'

describe('hasUsableCaip2Id', () => {
  it('accepts a namespace:reference string', () => {
    expect(hasUsableCaip2Id('eip155:324')).toBe(true)
    expect(hasUsableCaip2Id('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')).toBe(true)
  })

  it('rejects a missing caip2id — the 28 entries this source ships with none', () => {
    // These entries cannot be matched to a network safely. Guessing from the
    // entry's name is exactly the mistake this codebase has already made twice
    // (chain 999 is HyperEVM to one registry, Wanchain Testnet to another), so an
    // entry with no identifier is skipped rather than matched by name.
    expect(hasUsableCaip2Id(undefined)).toBe(false)
    expect(hasUsableCaip2Id(null)).toBe(false)
  })

  it('rejects an empty string or one with no namespace separator', () => {
    expect(hasUsableCaip2Id('')).toBe(false)
    expect(hasUsableCaip2Id('eip155')).toBe(false)
  })

  it('rejects a non-string value', () => {
    expect(hasUsableCaip2Id(324)).toBe(false)
  })
})

describe('hasBrandedVariant', () => {
  it('accepts a variants list that includes branded', () => {
    expect(hasBrandedVariant(['background', 'branded', 'mono'])).toBe(true)
  })

  it('rejects a variants list missing branded', () => {
    expect(hasBrandedVariant(['background', 'mono'])).toBe(false)
  })

  it('rejects a non-array value', () => {
    expect(hasBrandedVariant(undefined)).toBe(false)
    expect(hasBrandedVariant('branded')).toBe(false)
  })
})

describe('toGibsChainId', () => {
  it("converts an eip155 identifier to this project's hyphenated form", () => {
    // The load-bearing conversion: eip155:324 must become eip155-324, never
    // something else — a wrong separator or truncation here would silently
    // orphan every eip155 entry the source carries.
    expect(toGibsChainId('eip155:324')).toBe('eip155-324')
  })

  it('carries a non-Ethereum namespace through untouched, rather than coercing it to eip155', () => {
    // A solana or cosmos identifier must survive as its own namespace. Nothing
    // here may turn it into an eip155-looking identifier, which would silently
    // claim it names an Ethereum-Virtual-Machine chain.
    expect(toGibsChainId('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')).toBe('solana-5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
    expect(toGibsChainId('cosmos:kaiyo-1')).toBe('cosmos-kaiyo-1')
  })

  it('replaces only the namespace-separating colon, leaving hyphens already in the reference alone', () => {
    // cip-34's own namespace name carries a hyphen before the colon ever does.
    expect(toGibsChainId('cip-34:1-764824073')).toBe('cip-34-1-764824073')
  })
})

describe('brandedIconUrl', () => {
  it('builds the branded icon address for an entry id', () => {
    expect(brandedIconUrl('zksync')).toBe(
      'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/networks/branded/zksync.svg',
    )
  })
})

/** A well-formed web3icons network entry, cloned and mutated per test. */
const validEntry = () => ({
  id: 'zksync',
  chainId: 324,
  caip2id: 'eip155:324',
  name: 'zkSync era',
  variants: ['background', 'branded', 'mono'],
})

describe('parseNetworkEntries', () => {
  it('collects a well-formed entry into its chain identifier and icon address', () => {
    expect(parseNetworkEntries([validEntry()])).toEqual([
      {
        chainId: 'eip155-324',
        iconUrl:
          'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/networks/branded/zksync.svg',
      },
    ])
  })

  it('skips an entry with no caip2id instead of guessing one from its name', () => {
    const { caip2id: _drop, ...noCaip2Id } = validEntry()
    expect(parseNetworkEntries([noCaip2Id])).toEqual([])
  })

  it('carries a non-Ethereum namespace through the full pipeline untouched', () => {
    const solanaEntry = { id: 'solana', caip2id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', variants: ['branded'] }
    const cosmosEntry = { id: 'kujira', caip2id: 'cosmos:kaiyo-1', variants: ['branded'] }
    expect(parseNetworkEntries([solanaEntry, cosmosEntry])).toEqual([
      {
        chainId: 'solana-5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        iconUrl:
          'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/networks/branded/solana.svg',
      },
      {
        chainId: 'cosmos-kaiyo-1',
        iconUrl:
          'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/networks/branded/kujira.svg',
      },
    ])
  })

  it('skips an entry with no branded variant', () => {
    expect(parseNetworkEntries([{ ...validEntry(), variants: ['background', 'mono'] }])).toEqual([])
  })

  it('skips an entry with no id, or an empty one', () => {
    const { id: _drop, ...noId } = validEntry()
    expect(parseNetworkEntries([noId])).toEqual([])
    expect(parseNetworkEntries([{ ...validEntry(), id: '' }])).toEqual([])
  })

  it('skips a non-object entry in the array (null, string, number)', () => {
    expect(parseNetworkEntries([null, 'nope', 42, validEntry()])).toEqual([
      {
        chainId: 'eip155-324',
        iconUrl:
          'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/networks/branded/zksync.svg',
      },
    ])
  })

  it('returns an empty list when the feed answers with something other than an array', () => {
    expect(parseNetworkEntries(null)).toEqual([])
    expect(parseNetworkEntries(undefined)).toEqual([])
    expect(parseNetworkEntries({})).toEqual([])
  })
})
