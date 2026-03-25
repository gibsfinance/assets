import { describe, it, expect, vi } from 'vitest'

/**
 * Mock the db module so the transitive import chain (db → log → App.tsx JSX)
 * never loads during tests for the pure-function coverage here.
 */
vi.mock('../db', () => ({
  insertImage: vi.fn(),
}))

/**
 * Mock file-type so the ESM-only package doesn't cause transform issues.
 */
vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn(),
}))

import { parseDataUri } from './image-submit'

describe('parseDataUri', () => {
  it('returns mime and buffer for a valid PNG data URI', () => {
    // Minimal 1x1 PNG in base64
    const base64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const dataUri = `data:image/png;base64,${base64}`

    const result = parseDataUri(dataUri)

    expect(result).not.toBeNull()
    expect(result!.mime).toBe('image/png')
    expect(Buffer.isBuffer(result!.buffer)).toBe(true)
    expect(result!.buffer.length).toBeGreaterThan(0)
  })

  it('returns mime and buffer for a valid SVG data URI', () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>'
    const base64 = Buffer.from(svgContent).toString('base64')
    const dataUri = `data:image/svg+xml;base64,${base64}`

    const result = parseDataUri(dataUri)

    expect(result).not.toBeNull()
    expect(result!.mime).toBe('image/svg+xml')
    expect(result!.buffer.toString('utf8')).toBe(svgContent)
  })

  it('returns null for a string without the data: prefix', () => {
    expect(parseDataUri('https://example.com/image.png')).toBeNull()
    expect(parseDataUri('image.png')).toBeNull()
    expect(parseDataUri('')).toBeNull()
  })

  it('returns null for a malformed data URI missing the base64 content', () => {
    // has the prefix and semicolon but no content after the comma
    expect(parseDataUri('data:image/png;base64,')).toBeNull()
    // missing the ;base64, segment entirely
    expect(parseDataUri('data:image/png')).toBeNull()
  })

  it('decodes base64 content to the original bytes', () => {
    const original = 'hello world'
    const base64 = Buffer.from(original).toString('base64')
    const dataUri = `data:text/plain;base64,${base64}`

    const result = parseDataUri(dataUri)

    expect(result).not.toBeNull()
    expect(result!.buffer.toString('utf8')).toBe(original)
  })
})
