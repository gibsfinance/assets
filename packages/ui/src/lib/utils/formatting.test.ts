import { describe, it, expect } from 'vitest'
import {
  formatPercent,
  overlapLabel,
  truncateAddress,
  cubicEaseOut,
  clampValue,
  formatBytes,
  detectImageFormat,
  buildImageUrlWithSize,
  generateRepoName,
  generateCommitMessage,
} from './formatting'

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

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })
})

describe('detectImageFormat', () => {
  it('detects format from data URI', () => {
    expect(detectImageFormat('data:image/png;base64,abc')).toBe('png')
    expect(detectImageFormat('data:image/svg+xml;base64,abc')).toBe('svg+xml')
  })

  it('returns unknown for malformed data URI', () => {
    expect(detectImageFormat('data:;base64,abc')).toBe('unknown')
  })

  it('detects format from URL extension', () => {
    expect(detectImageFormat('https://example.com/token.png')).toBe('png')
    expect(detectImageFormat('https://example.com/token.svg')).toBe('svg')
    expect(detectImageFormat('https://example.com/token.webp?w=64')).toBe('webp')
  })

  it('returns auto for unknown extension', () => {
    expect(detectImageFormat('https://example.com/token')).toBe('auto')
    expect(detectImageFormat('https://example.com/token.bmp')).toBe('auto')
  })
})

describe('buildImageUrlWithSize', () => {
  it('appends w and h params to URL', () => {
    expect(buildImageUrlWithSize('https://gib.show/image/1/0xabc', 64, 64)).toBe(
      'https://gib.show/image/1/0xabc?w=64&h=64',
    )
  })

  it('uses & when URL already has query params', () => {
    expect(buildImageUrlWithSize('https://gib.show/image/1/0xabc?as=webp', 64, 64)).toBe(
      'https://gib.show/image/1/0xabc?as=webp&w=64&h=64',
    )
  })

  it('passes through data URIs unchanged', () => {
    const dataUri = 'data:image/png;base64,abc'
    expect(buildImageUrlWithSize(dataUri, 64, 64)).toBe(dataUri)
  })
})

describe('generateRepoName', () => {
  it('generates slug from list name', () => {
    expect(generateRepoName('My Token List')).toBe('token-list-my-token-list')
  })

  it('uses custom name when provided', () => {
    expect(generateRepoName('My List', 'custom-repo')).toBe('custom-repo')
  })
})

describe('generateCommitMessage', () => {
  it('generates default message', () => {
    expect(generateCommitMessage('PulseChain Tokens')).toBe('Update PulseChain Tokens token list')
  })

  it('uses custom message when provided', () => {
    expect(generateCommitMessage('X', 'feat: add new tokens')).toBe('feat: add new tokens')
  })
})
