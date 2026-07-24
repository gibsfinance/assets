/**
 * Ranking behaviour for the collector priority list.
 *
 * The list itself is checked against the collector registry in collectables.test.ts,
 * which already carries the mocks needed to load that graph. This file stays free of
 * it deliberately — the point of splitting the order out of `collectables.ts` was that
 * ranking a provider should not require importing every collector.
 */
import { describe, it, expect } from 'vitest'
import { collectableOrder, collectablePriority } from './collectable-order'

describe('collectable priority', () => {
  it('ranks an earlier collector above a later one', () => {
    // The registry's own doc comment: "position in this array determines image
    // priority ranking". chainlist is deliberately last — "kept last so any
    // chain-specific logo outranks it" — which is exactly the intent that was
    // inverted while network icons were written last-write-wins.
    expect(collectablePriority('smoldapp')).toBeLessThan(collectablePriority('cryptocurrency-icons'))
    expect(collectablePriority('cryptocurrency-icons')).toBeLessThan(collectablePriority('chainlist'))
  })

  it('sorts an unknown or absent key last so unattributed rows can be claimed', () => {
    // Network rows written before provenance was recorded carry a null key. Ranking
    // those last is what lets the next collection run settle them onto a real source
    // instead of freezing whichever collector happened to finish last.
    expect(collectablePriority(null)).toBe(Number.MAX_SAFE_INTEGER)
    expect(collectablePriority(undefined)).toBe(Number.MAX_SAFE_INTEGER)
    expect(collectablePriority('not-a-collector')).toBe(Number.MAX_SAFE_INTEGER)
    expect(collectablePriority('chainlist')).toBeLessThan(collectablePriority(null))
  })

  it('gives every listed collector a distinct rank', () => {
    // Two collectors sharing a rank would make the comparison a coin toss again for
    // that pair, which is the whole failure being fixed.
    expect(new Set(collectableOrder.map(collectablePriority)).size).toBe(collectableOrder.length)
  })
})
