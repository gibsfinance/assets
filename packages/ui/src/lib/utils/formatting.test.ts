import { describe, it, expect } from 'vitest'
import { formatPercent, overlapLabel, truncateAddress, cubicEaseOut, clampValue } from './formatting'

describe('formatPercent', () => {
  it('formats whole ratios', () => {
    expect(formatPercent(1)).toBe('100%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.5)).toBe('50%')
  })

  it('rounds to nearest integer', () => {
    expect(formatPercent(0.333)).toBe('33%')
    expect(formatPercent(0.667)).toBe('67%')
    expect(formatPercent(0.995)).toBe('100%')
  })

  it('handles values beyond 0-1', () => {
    expect(formatPercent(1.5)).toBe('150%')
    expect(formatPercent(-0.1)).toBe('-10%')
  })
})

describe('overlapLabel', () => {
  it('returns Float for highly negative overlap', () => {
    expect(overlapLabel(-0.5)).toBe('Float')
    expect(overlapLabel(-1)).toBe('Float')
  })

  it('returns Float at exact -0.4 boundary', () => {
    expect(overlapLabel(-0.4)).toBe('Float')
  })

  it('returns Edge for near-zero overlap', () => {
    expect(overlapLabel(0)).toBe('Edge')
    expect(overlapLabel(-0.3)).toBe('Edge')
    expect(overlapLabel(0.3)).toBe('Edge')
    expect(overlapLabel(0.39)).toBe('Edge')
  })

  it('returns Inset for high overlap', () => {
    expect(overlapLabel(0.4)).toBe('Inset')
    expect(overlapLabel(0.5)).toBe('Inset')
    expect(overlapLabel(1)).toBe('Inset')
  })
})

describe('truncateAddress', () => {
  const addr = '0x1234567890abcdef1234567890abcdef12345678'

  it('truncates long addresses with default lengths', () => {
    const result = truncateAddress(addr)
    expect(result).toBe('0x12345678...345678')
    expect(result.length).toBeLessThan(addr.length)
  })

  it('preserves short strings that fit within bounds', () => {
    expect(truncateAddress('0x1234')).toBe('0x1234')
  })

  it('supports custom prefix/suffix lengths', () => {
    expect(truncateAddress(addr, 6, 4)).toBe('0x1234...5678')
  })

  it('handles exact boundary length', () => {
    const exact = '0123456789abcdef'
    expect(truncateAddress(exact, 8, 8)).toBe(exact)
  })
})

describe('cubicEaseOut', () => {
  it('returns 0 at progress 0', () => {
    expect(cubicEaseOut(0)).toBe(0)
  })

  it('returns 1 at progress 1', () => {
    expect(cubicEaseOut(1)).toBe(1)
  })

  it('accelerates early — halfway progress yields more than half output', () => {
    expect(cubicEaseOut(0.5)).toBeGreaterThan(0.5)
  })

  it('is monotonically increasing', () => {
    const samples = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    for (let i = 1; i < samples.length; i++) {
      expect(cubicEaseOut(samples[i])).toBeGreaterThanOrEqual(cubicEaseOut(samples[i - 1]))
    }
  })

  it('computes known value at 0.5', () => {
    // 1 - (1 - 0.5)^3 = 1 - 0.125 = 0.875
    expect(cubicEaseOut(0.5)).toBe(0.875)
  })
})

describe('clampValue', () => {
  it('returns value when within range', () => {
    expect(clampValue(5, 0, 10)).toBe(5)
  })

  it('clamps to min', () => {
    expect(clampValue(-5, 0, 10)).toBe(0)
  })

  it('clamps to max', () => {
    expect(clampValue(15, 0, 10)).toBe(10)
  })

  it('handles equal min and max', () => {
    expect(clampValue(5, 3, 3)).toBe(3)
  })

  it('handles value at boundaries', () => {
    expect(clampValue(0, 0, 10)).toBe(0)
    expect(clampValue(10, 0, 10)).toBe(10)
  })
})
