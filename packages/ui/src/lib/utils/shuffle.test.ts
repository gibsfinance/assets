/**
 * The shuffle behind the scrolling icon bands.
 *
 * Every test here supplies its own source of randomness. That is the whole
 * reason the source is a parameter: with `Math.random` the only honest claims
 * are "same length" and "same members", and both of those hold for a function
 * that never moves anything.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { shuffle } from './shuffle'

/** Hands back the given numbers in order, then repeats the last one. */
const scriptedRandom = (values: number[]) => {
  let call = 0
  return () => values[Math.min(call++, values.length - 1)]
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('shuffle', () => {
  it("leaves the caller's array untouched", () => {
    // The icon list is a module constant shared by every band. Shuffling it in
    // place would reorder it for everyone and never put it back.
    const original = ['a', 'b', 'c', 'd']
    const copy = [...original]
    shuffle(original, () => 0)
    expect(original).toEqual(copy)
  })

  it('returns a new array rather than the one it was given', () => {
    const original = ['a', 'b']
    expect(shuffle(original, () => 0)).not.toBe(original)
  })

  it('keeps every member, so no icon is lost or shown twice', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    const result = shuffle(items, scriptedRandom([0.9, 0.1, 0.5, 0.3]))
    expect([...result].sort()).toEqual([...items].sort())
    expect(result).toHaveLength(items.length)
  })

  it('produces the exact order the given source asks for', () => {
    // Four items, so the walk draws three times, at i of 3, 2 and 1. A source of
    // zero sends every draw to index 0, and repeatedly swapping the front with
    // the shrinking tail rotates the array left by one. The point is that the
    // order is stated outright rather than only checked for being a permutation.
    const result = shuffle(['a', 'b', 'c', 'd'], () => 0)
    expect(result).toEqual(['b', 'c', 'd', 'a'])
  })

  it('draws only from the part it has not visited yet', () => {
    // A source of just under one picks the highest index still in range, which
    // for the walk from the end is the item already in place. Every draw is
    // therefore a swap with itself, and the order must come back unchanged.
    // Drawing from the whole array instead — the classic biased variant — would
    // reach past `i` and move something.
    const items = ['a', 'b', 'c', 'd', 'e']
    expect(shuffle(items, () => 0.999)).toEqual(items)
  })

  it('returns an empty array for an empty input', () => {
    expect(shuffle([], () => 0)).toEqual([])
  })

  it('returns a single item unchanged without drawing at all', () => {
    // The loop starts at the last index and stops above zero, so one item needs
    // no randomness. A source that throws proves nothing was drawn.
    const throwing = () => {
      throw new Error('the source must not be read for a single item')
    }
    expect(shuffle(['only'], throwing)).toEqual(['only'])
  })

  it('falls back to the global generator when no source is given', () => {
    // The icon bands pass no source, so the default has to be the global
    // generator. The stub returns 0.5 rather than 0 on purpose: a default
    // replaced by a constant would still pass against 0, because 0 is what a
    // hard-coded stand-in most naturally returns. Half of three rounds to index
    // one, which swaps only the last two items.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(shuffle(['a', 'b', 'c'])).toEqual(['a', 'c', 'b'])
  })
})
