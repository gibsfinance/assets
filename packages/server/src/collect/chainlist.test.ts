import { describe, it, expect } from 'vitest'
import { parseChains, pickIconUrl } from './chainlist-parse'

describe('parseChains', () => {
  it('keeps only chains with a positive integer chainId and a non-empty icon key', () => {
    const raw = [
      { chainId: 1, name: 'Ethereum Mainnet', icon: 'ethereum' },
      { chainId: 137, name: 'Polygon', icon: 'polygon' },
      { chainId: 250, name: 'Fantom' }, // no icon -> dropped
      { chainId: 0, name: 'Zero', icon: 'zero' }, // non-positive -> dropped
      { chainId: 1.5, name: 'Frac', icon: 'frac' }, // non-integer -> dropped
      { chainId: '8453', name: 'Base', icon: 'base' }, // string chainId -> dropped
      { name: 'No id', icon: 'x' }, // missing chainId -> dropped
      { chainId: 100, name: 'Gnosis', icon: '' }, // empty icon -> dropped
    ]
    expect(parseChains(raw)).toEqual([
      { chainId: 1, icon: 'ethereum', name: 'Ethereum Mainnet' },
      { chainId: 137, icon: 'polygon', name: 'Polygon' },
    ])
  })

  it('dedupes by chainId, keeping the first occurrence', () => {
    const raw = [
      { chainId: 1, name: 'Ethereum', icon: 'ethereum' },
      { chainId: 1, name: 'Ethereum dup', icon: 'other' },
    ]
    expect(parseChains(raw)).toEqual([{ chainId: 1, icon: 'ethereum', name: 'Ethereum' }])
  })

  it('tolerates non-array and junk input', () => {
    expect(parseChains(null)).toEqual([])
    expect(parseChains({})).toEqual([])
    expect(parseChains([null, 42, 'nope', {}])).toEqual([])
  })

  /**
   * The name rides along with the icon so the two cannot drift, but the icon is what
   * this collector exists for — a chain must still be collected when upstream has no
   * usable name, leaving the label to the client's fallback map.
   */
  describe('name', () => {
    it('keeps an icon-bearing chain whose name is missing, null, or blank', () => {
      const raw = [
        { chainId: 704851, name: null, icon: 'nameless' },
        { chainId: 2, icon: 'absent' },
        { chainId: 3, name: '   ', icon: 'blank' },
      ]
      expect(parseChains(raw)).toEqual([
        { chainId: 704851, icon: 'nameless', name: undefined },
        { chainId: 2, icon: 'absent', name: undefined },
        { chainId: 3, icon: 'blank', name: undefined },
      ])
    })

    it('trims a padded name', () => {
      expect(parseChains([{ chainId: 1, name: '  Ethereum Mainnet  ', icon: 'ethereum' }])).toEqual([
        { chainId: 1, icon: 'ethereum', name: 'Ethereum Mainnet' },
      ])
    })

    it('ignores a name that is not a string', () => {
      expect(parseChains([{ chainId: 1, name: 42, icon: 'ethereum' }])).toEqual([
        { chainId: 1, icon: 'ethereum', name: undefined },
      ])
    })
  })
})

describe('pickIconUrl', () => {
  it('returns the first descriptor url (an ipfs uri)', () => {
    const raw = [
      { url: 'ipfs://QmdwQDr6vmBtXmK2TmknkEuZNoaDqTasFdZdu3DRw8b2wt', width: 1000, height: 1628, format: 'png' },
    ]
    expect(pickIconUrl(raw)).toBe('ipfs://QmdwQDr6vmBtXmK2TmknkEuZNoaDqTasFdZdu3DRw8b2wt')
  })

  it('accepts an https url too', () => {
    expect(pickIconUrl([{ url: 'https://example.com/logo.png' }])).toBe('https://example.com/logo.png')
  })

  it('returns null for empty, malformed, or urlless descriptors', () => {
    expect(pickIconUrl([])).toBeNull()
    expect(pickIconUrl(null)).toBeNull()
    expect(pickIconUrl([{ width: 10 }])).toBeNull()
    expect(pickIconUrl([{ url: '' }])).toBeNull()
    expect(pickIconUrl([{ url: 42 }])).toBeNull()
  })
})
