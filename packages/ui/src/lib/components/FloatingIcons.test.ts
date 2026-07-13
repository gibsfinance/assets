import { describe, it, expect } from 'vitest'
import { repeatsToFill } from './FloatingIcons'

describe('repeatsToFill', () => {
  // One conveyor "half" must be at least the viewport width, or the seamless -50%
  // loop (and the reverse-direction middle row, which starts at -50%) leaves a bare
  // strip on the right. These cases pin the geometry that closes that gap.
  it('returns 1 when a single sample already spans the viewport', () => {
    // 30 icons × (32 + 12) = 1320px half, viewport 1200px → one copy covers it.
    expect(repeatsToFill(1200, 32, 30)).toBe(1)
  })

  it('repeats enough to cover a viewport wider than one sample', () => {
    // 1320px half, 1920px viewport → ceil(1920/1320) = 2 copies.
    expect(repeatsToFill(1920, 32, 30)).toBe(2)
  })

  it('scales up for ultrawide viewports', () => {
    // 1320px half, 3840px viewport → ceil(3840/1320) = 3 copies.
    expect(repeatsToFill(3840, 32, 30)).toBe(3)
  })

  it('accounts for the per-row icon size when sizing a half', () => {
    // Larger icons make each half wider, so fewer repeats are needed.
    expect(repeatsToFill(2000, 36, 30)).toBe(2)
    expect(repeatsToFill(2000, 28, 30)).toBe(2)
  })

  it('never returns fewer than 1 repeat', () => {
    expect(repeatsToFill(0, 32, 30)).toBe(1)
    expect(repeatsToFill(-100, 32, 30)).toBe(1)
    expect(repeatsToFill(1920, 32, 0)).toBe(1)
  })
})
