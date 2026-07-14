/**
 * Tests for rankTokenRows — the comparator that orders duplicate token images.
 *
 * Why: when several providers supply an image for the same token, this single
 * comparator decides which one wins (and the order of the rest). The priority
 * chain is intentional: provider ranking band first, then "has an image at all",
 * then format preference (svg > webp > everything else), then the list's own
 * order as a stable tiebreak. Each tier is pinned independently, plus the full
 * chain via Array.sort, so a reordering of the rules fails here.
 */
import { describe, it, expect } from 'vitest'
import { rankTokenRows } from './ranking'

describe('rankTokenRows', () => {
  describe('tier 1 — provider ranking band (floor of ranking / 1000)', () => {
    it('orders a lower ranking band before a higher one', () => {
      const low = { listRanking: 1500 } // band 1
      const high = { listRanking: 2500 } // band 2
      expect(rankTokenRows(low, high)).toBeLessThan(0)
      expect(rankTokenRows(high, low)).toBeGreaterThan(0)
    })

    it('treats rankings within the same 1000-band as equal at this tier', () => {
      // 1000 and 1999 both floor to band 1 — the comparator must fall through
      // to later tiers rather than separating them here.
      const a = { listRanking: 1000, imageHash: 'h', ext: '.svg' }
      const b = { listRanking: 1999, imageHash: 'h', ext: '.svg' }
      expect(rankTokenRows(a, b)).toBe(0)
    })

    it('sorts a missing ranking last (treated as MAX_SAFE_INTEGER)', () => {
      const ranked = { listRanking: 5000 }
      const unranked = { listRanking: null }
      expect(rankTokenRows(ranked, unranked)).toBeLessThan(0)
      expect(rankTokenRows({}, ranked)).toBeGreaterThan(0)
    })
  })

  describe('tier 2 — image presence', () => {
    it('prefers a row that has an image hash over one that does not', () => {
      const withImage = { listRanking: 1000, imageHash: 'abc' }
      const without = { listRanking: 1000, imageHash: null }
      expect(rankTokenRows(withImage, without)).toBeLessThan(0)
      expect(rankTokenRows(without, withImage)).toBeGreaterThan(0)
    })

    it('only applies image presence within the same ranking band', () => {
      // an imageless row in a better band still beats an imaged row in a worse band
      const betterBandNoImage = { listRanking: 1000, imageHash: null }
      const worseBandWithImage = { listRanking: 9000, imageHash: 'abc' }
      expect(rankTokenRows(betterBandNoImage, worseBandWithImage)).toBeLessThan(0)
    })
  })

  describe('tier 3 — format preference (svg > webp > other)', () => {
    const base = { listRanking: 1000, imageHash: 'h' }

    it('prefers svg over webp', () => {
      expect(rankTokenRows({ ...base, ext: '.svg' }, { ...base, ext: '.webp' })).toBeLessThan(0)
    })

    it('treats .svg and .svg+xml as the same top-preference format', () => {
      expect(rankTokenRows({ ...base, ext: '.svg' }, { ...base, ext: '.svg+xml' })).toBe(0)
    })

    it('prefers webp over a non-preferred format like png', () => {
      expect(rankTokenRows({ ...base, ext: '.webp' }, { ...base, ext: '.png' })).toBeLessThan(0)
    })

    it('treats two non-preferred formats as equal at this tier', () => {
      expect(rankTokenRows({ ...base, ext: '.png' }, { ...base, ext: '.jpg' })).toBe(0)
    })
  })

  describe('tier 4 — list order tiebreak', () => {
    it('falls back to listTokenOrderId when all higher tiers are equal', () => {
      const base = { listRanking: 1000, imageHash: 'h', ext: '.svg' }
      expect(rankTokenRows({ ...base, listTokenOrderId: 1 }, { ...base, listTokenOrderId: 2 })).toBeLessThan(0)
      expect(rankTokenRows({ ...base, listTokenOrderId: 5 }, { ...base, listTokenOrderId: 5 })).toBe(0)
    })

    it('treats a missing listTokenOrderId as 0', () => {
      const base = { listRanking: 1000, imageHash: 'h', ext: '.svg' }
      expect(rankTokenRows({ ...base }, { ...base, listTokenOrderId: 1 })).toBeLessThan(0)
    })
  })

  describe('full chain via Array.sort', () => {
    it('orders a mixed set by ranking band, then image, then format, then list order', () => {
      const rows = [
        { id: 'png-band1', listRanking: 1000, imageHash: 'h', ext: '.png', listTokenOrderId: 0 },
        { id: 'svg-band2', listRanking: 2000, imageHash: 'h', ext: '.svg', listTokenOrderId: 0 },
        { id: 'svg-band1', listRanking: 1200, imageHash: 'h', ext: '.svg', listTokenOrderId: 0 },
        { id: 'noimg-band1', listRanking: 1100, imageHash: null, ext: '.svg', listTokenOrderId: 0 },
        { id: 'webp-band1', listRanking: 1300, imageHash: 'h', ext: '.webp', listTokenOrderId: 0 },
      ]
      const sorted = [...rows].sort(rankTokenRows).map((r) => r.id)
      expect(sorted).toEqual([
        'svg-band1', // band 1, image, svg
        'webp-band1', // band 1, image, webp
        'png-band1', // band 1, image, png
        'noimg-band1', // band 1, no image
        'svg-band2', // band 2
      ])
    })
  })
})
