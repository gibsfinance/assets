import { describe, it, expect } from 'vitest'
import { conveyorIconSrc, repeatsToFill } from './FloatingIcons'

describe('conveyorIconSrc', () => {
  /**
   * The bug this pins: the band asked for `format=webp` long after the server had
   * renamed the parameter to `as`. Nothing failed — an unknown parameter is ignored,
   * so every icon quietly came back as the full-size PNG and the band carried ~65%
   * more bytes than it should. Asserting the exact parameter name is the only thing
   * that catches a rename, since the symptom is payload size, never an error.
   */
  it('requests conversion with `as`, the parameter the server actually reads', () => {
    expect(conveyorIconSrc('/image/1')).toContain('as=webp')
  })

  it('does not use `format`, the parameter the server dropped', () => {
    expect(conveyorIconSrc('/image/1')).not.toContain('format=')
  })

  // Icons render at 72px; requesting that size is what keeps the payload small.
  it('requests the rendered size rather than the full-resolution source', () => {
    expect(conveyorIconSrc('/image/1')).toBe('/image/1?w=72&h=72&as=webp')
  })

  it('builds the same shape for a non-eip155 identifier', () => {
    expect(conveyorIconSrc('/image/tvm-195')).toBe('/image/tvm-195?w=72&h=72&as=webp')
  })
})

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
