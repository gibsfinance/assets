import { describe, it, expect } from 'vitest'
import { rankTokenRows } from './ranking'

// ---------------------------------------------------------------------------
// Pure function tests — no mocks, no Express, no DB
// ---------------------------------------------------------------------------

function row(overrides: Record<string, unknown> = {}) {
  return {
    listRanking: 1000,
    imageHash: 'hash1',
    ext: '.png',
    listTokenOrderId: 0,
    ...overrides,
  }
}

describe('rankTokenRows', () => {
  it('sorts by ranking tier (ranking / 1000)', () => {
    const rows = [
      row({ listRanking: 5000 }),
      row({ listRanking: 1000 }),
      row({ listRanking: 3000 }),
    ]
    rows.sort(rankTokenRows)
    expect(rows.map((r) => r.listRanking)).toEqual([1000, 3000, 5000])
  })

  it('groups rankings within the same 1000-tier together', () => {
    const rows = [
      row({ listRanking: 1005, listTokenOrderId: 5 }),
      row({ listRanking: 1002, listTokenOrderId: 2 }),
      row({ listRanking: 2000, listTokenOrderId: 0 }),
    ]
    rows.sort(rankTokenRows)
    // 1005 and 1002 are both tier 1 (floor(x/1000)=1), so they sort by listTokenOrderId
    expect(rows[0].listRanking).toBe(1002)
    expect(rows[1].listRanking).toBe(1005)
    expect(rows[2].listRanking).toBe(2000)
  })

  it('prefers rows with images over rows without at same ranking', () => {
    const withImage = row({ listRanking: 1000, imageHash: 'hash1' })
    const withoutImage = row({ listRanking: 1000, imageHash: null })
    const rows = [withoutImage, withImage]
    rows.sort(rankTokenRows)
    expect(rows[0]).toBe(withImage)
    expect(rows[1]).toBe(withoutImage)
  })

  it('prefers SVG over WebP over raster at same ranking and image presence', () => {
    const svg = row({ ext: '.svg', imageHash: 'a' })
    const webp = row({ ext: '.webp', imageHash: 'c' })
    const png = row({ ext: '.png', imageHash: 'd' })
    const rows = [png, webp, svg]
    rows.sort(rankTokenRows)
    // SVG gets format score 0, WebP gets 1, PNG gets 2
    expect(rows[0].ext).toBe('.svg')
    expect(rows[1].ext).toBe('.webp')
    expect(rows[2].ext).toBe('.png')
  })

  it('treats .svg and .svg+xml as equivalent format tier', () => {
    const svg = row({ ext: '.svg', imageHash: 'a' })
    const svgXml = row({ ext: '.svg+xml', imageHash: 'b' })
    const png = row({ ext: '.png', imageHash: 'c' })
    const rows = [png, svgXml, svg]
    rows.sort(rankTokenRows)
    // Both SVG variants get score 0, both should come before PNG
    expect(['.svg', '.svg+xml']).toContain(rows[0].ext)
    expect(['.svg', '.svg+xml']).toContain(rows[1].ext)
    expect(rows[2].ext).toBe('.png')
  })

  it('falls back to listTokenOrderId when everything else is equal', () => {
    const rows = [
      row({ listTokenOrderId: 50 }),
      row({ listTokenOrderId: 10 }),
      row({ listTokenOrderId: 30 }),
    ]
    rows.sort(rankTokenRows)
    expect(rows.map((r) => r.listTokenOrderId)).toEqual([10, 30, 50])
  })

  it('handles null/missing listRanking (unranked rows sort last)', () => {
    const ranked = row({ listRanking: 1000 })
    const unranked = row({ listRanking: null })
    const missing = row({ listRanking: undefined })
    const rows = [unranked, missing, ranked]
    rows.sort(rankTokenRows)
    expect(rows[0]).toBe(ranked)
    // unranked and missing both get MAX_SAFE_INTEGER tier
  })

  it('handles null/missing imageHash', () => {
    const withImage = row({ imageHash: 'hash', ext: '.png' })
    const noImage = row({ imageHash: null, ext: null })
    const rows = [noImage, withImage]
    rows.sort(rankTokenRows)
    expect(rows[0]).toBe(withImage)
  })

  it('handles null/missing ext', () => {
    const withExt = row({ ext: '.svg', imageHash: 'a' })
    const noExt = row({ ext: null, imageHash: 'b' })
    const rows = [noExt, withExt]
    rows.sort(rankTokenRows)
    expect(rows[0]).toBe(withExt) // SVG=0 beats null=2
  })

  it('is deterministic — same input always produces same output', () => {
    const input = [
      row({ listRanking: 3000, ext: '.png', imageHash: 'a', listTokenOrderId: 5 }),
      row({ listRanking: 1000, ext: '.svg', imageHash: 'b', listTokenOrderId: 1 }),
      row({ listRanking: 1000, ext: '.png', imageHash: 'c', listTokenOrderId: 2 }),
      row({ listRanking: 1000, ext: null, imageHash: null, listTokenOrderId: 3 }),
      row({ listRanking: 2000, ext: '.webp', imageHash: 'd', listTokenOrderId: 4 }),
    ]

    const result1 = [...input].sort(rankTokenRows).map((r) => r.listTokenOrderId)
    const result2 = [...input].sort(rankTokenRows).map((r) => r.listTokenOrderId)
    const result3 = [...input.reverse()].sort(rankTokenRows).map((r) => r.listTokenOrderId)

    expect(result1).toEqual(result2)
    expect(result1).toEqual(result3)
    // Expected order: ranking 1000 SVG (id=1), ranking 1000 PNG (id=2), ranking 1000 no-image (id=3),
    //                 ranking 2000 WebP (id=4), ranking 3000 PNG (id=5)
    expect(result1).toEqual([1, 2, 3, 4, 5])
  })

  it('handles large arrays efficiently', () => {
    const rows = Array.from({ length: 10000 }, (_, i) =>
      row({
        listRanking: Math.floor(Math.random() * 10) * 1000,
        imageHash: Math.random() > 0.3 ? `h${i}` : null,
        ext: ['.svg', '.png', '.webp', null][Math.floor(Math.random() * 4)],
        listTokenOrderId: i,
      }),
    )
    const start = performance.now()
    rows.sort(rankTokenRows)
    const elapsed = performance.now() - start
    // 10k rows should sort in under 50ms
    expect(elapsed).toBeLessThan(50)

    // Verify sort invariant: no row should be "less than" its predecessor
    for (let i = 1; i < rows.length; i++) {
      expect(rankTokenRows(rows[i - 1], rows[i])).toBeLessThanOrEqual(0)
    }
  })
})
