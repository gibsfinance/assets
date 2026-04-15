import { describe, it, expect } from 'vitest'
import { isDefaultOrder, reorderArray, DEFAULT_PROVIDERS } from './list-order'

describe('isDefaultOrder', () => {
  it('returns true for exact default order', () => {
    expect(isDefaultOrder([...DEFAULT_PROVIDERS])).toBe(true)
  })

  it('returns false for different order', () => {
    const reversed = [...DEFAULT_PROVIDERS].reverse()
    expect(isDefaultOrder(reversed)).toBe(false)
  })

  it('returns false for subset', () => {
    expect(isDefaultOrder(['coingecko', 'uniswap'])).toBe(false)
  })

  it('returns false for superset', () => {
    expect(isDefaultOrder([...DEFAULT_PROVIDERS, 'extra'])).toBe(false)
  })

  it('returns false for empty array', () => {
    expect(isDefaultOrder([])).toBe(false)
  })

  it('returns false when one provider differs', () => {
    const modified: string[] = [...DEFAULT_PROVIDERS]
    modified[0] = 'custom'
    expect(isDefaultOrder(modified)).toBe(false)
  })
})

describe('reorderArray', () => {
  it('moves an item forward', () => {
    expect(reorderArray(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves an item backward', () => {
    expect(reorderArray(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('returns same order when from equals to', () => {
    expect(reorderArray(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the original array', () => {
    const original = ['a', 'b', 'c']
    const copy = [...original]
    reorderArray(original, 0, 2)
    expect(original).toEqual(copy)
  })

  it('handles single-element array', () => {
    expect(reorderArray(['a'], 0, 0)).toEqual(['a'])
  })

  it('moves last to first', () => {
    expect(reorderArray([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3])
  })

  it('moves first to last', () => {
    expect(reorderArray([1, 2, 3, 4], 0, 3)).toEqual([2, 3, 4, 1])
  })
})
