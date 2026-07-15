import { describe, it, expect } from 'vitest'
import { toNameMap, mergeNameMaps } from './network-name-source'

describe('toNameMap', () => {
  it('keeps chains that carry a positive-integer id and a name', () => {
    expect(
      toNameMap([
        { chainId: 1, name: 'Ethereum Mainnet' },
        { chainId: 97477, name: 'Doma' },
      ]),
    ).toEqual({ '1': 'Ethereum Mainnet', '97477': 'Doma' })
  })

  // A nameless chain must not become an entry: getNetworkName treats any hit as
  // authoritative, so an empty name would render a blank label instead of falling
  // through to the "Chain <id>" a user can at least recognise. The registry really
  // does ship these — chain 704851 has a null name.
  it('drops entries without a usable name', () => {
    expect(toNameMap([{ chainId: 704851 }, { chainId: 2, name: '' }, { chainId: 3, name: '   ' }])).toEqual({})
  })

  it('drops entries whose id is not a positive integer', () => {
    expect(
      toNameMap([
        { chainId: 0, name: 'Zero' },
        { chainId: -1, name: 'Negative' },
        { chainId: 1.5, name: 'Float' },
        { chainId: '7', name: 'String' },
      ]),
    ).toEqual({})
  })

  it('trims surrounding whitespace from names', () => {
    expect(toNameMap([{ chainId: 1, name: '  Ethereum  ' }])).toEqual({ '1': 'Ethereum' })
  })

  it('throws when the payload is not an array', () => {
    expect(() => toNameMap({ chains: [] })).toThrow(/did not parse to an array/)
  })
})

describe('mergeNameMaps', () => {
  it('takes the upstream name when the registry still publishes the id', () => {
    expect(mergeNameMaps({ '25': 'Cronos Mainnet Beta' }, { '25': 'Cronos Mainnet' })).toEqual({
      '25': 'Cronos Mainnet',
    })
  })

  // The registry dropping a chain says nothing about whether we still serve tokens on
  // it. Deleting the name would regress that network's drawer label to "Chain 20402",
  // whereas keeping it only risks the name being dated.
  it('preserves an id that upstream dropped rather than losing its name', () => {
    expect(mergeNameMaps({ '20402': 'MUUCHAIN' }, { '1': 'Ethereum Mainnet' })).toEqual({
      '1': 'Ethereum Mainnet',
      '20402': 'MUUCHAIN',
    })
  })

  it('adds ids the committed map has never seen', () => {
    expect(mergeNameMaps({ '1': 'Ethereum Mainnet' }, { '1': 'Ethereum Mainnet', '97477': 'Doma' })).toEqual({
      '1': 'Ethereum Mainnet',
      '97477': 'Doma',
    })
  })

  // Numeric ordering keeps the committed file's diff readable; JSON key order would
  // otherwise follow insertion and scatter each regen's additions through the file.
  it('orders keys numerically, not lexicographically', () => {
    const merged = mergeNameMaps({}, { '100': 'Gnosis', '2': 'Expanse', '10': 'Optimism' })
    expect(Object.keys(merged)).toEqual(['2', '10', '100'])
  })

  it('leaves both inputs unmutated', () => {
    const existing = { '1': 'Ethereum Mainnet' }
    const upstream = { '2': 'Expanse Network' }
    mergeNameMaps(existing, upstream)
    expect(existing).toEqual({ '1': 'Ethereum Mainnet' })
    expect(upstream).toEqual({ '2': 'Expanse Network' })
  })
})
