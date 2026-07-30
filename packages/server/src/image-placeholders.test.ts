import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect } from 'vitest'

import { sanitizeImage } from './sanitize'
import { contentFingerprint, isPlaceholderImage, knownPlaceholders, placeholderByteLengths } from './image-placeholders'

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'harvested', 'dexscreener', name))

describe('isPlaceholderImage', () => {
  it('recognizes the DexScreener chain placeholder once sanitized', async () => {
    const sanitized = await sanitizeImage(fixture('chain-placeholder.png'), '.png')
    expect(isPlaceholderImage(sanitized)).toBe(true)
  })

  it('leaves real artwork alone', async () => {
    // A logo that is genuinely a logo must survive, otherwise the guard is
    // silently deleting the very images the service exists to serve.
    const realLogo = await sanitizeImage(fixture('chain-placeholder.png'), '.png').then((buffer) =>
      // Flip a single pixel's worth of bytes so the picture is no longer the
      // placeholder while staying the same size — the prefilter must not be the
      // only thing standing between a real image and rejection.
      Buffer.concat([buffer.subarray(0, buffer.length - 1), Buffer.from([buffer[buffer.length - 1] ^ 0xff])]),
    )
    expect(isPlaceholderImage(realLogo)).toBe(false)
  })

  it('ignores empty content, which link-mode providers store', () => {
    expect(isPlaceholderImage(Buffer.from([]))).toBe(false)
  })

  it('rejects on length before hashing, so ordinary images cost one comparison', () => {
    expect(isPlaceholderImage(Buffer.alloc(1024, 7))).toBe(false)
  })
})

describe('knownPlaceholders', () => {
  // Fingerprints are taken over sanitized bytes, so an upgrade to the image
  // library that changes its encoder output would silently stop every entry
  // from matching. Deriving both fields from the committed fixture here turns
  // that into a failing test rather than a guard that quietly does nothing.
  it('agrees with the fixture it was derived from', async () => {
    const sanitized = await sanitizeImage(fixture('chain-placeholder.png'), '.png')
    const entry = knownPlaceholders.find((candidate) => candidate.note.includes('DexScreener'))
    expect(entry).toBeDefined()
    expect(entry!.fingerprint).toBe(contentFingerprint(sanitized))
    expect(entry!.byteLength).toBe(sanitized.length)
  })

  it('keeps every declared byte length reachable from the prefilter', () => {
    for (const placeholder of knownPlaceholders) {
      expect(placeholderByteLengths).toContain(placeholder.byteLength)
    }
  })

  it('sanitizes idempotently, so stored copies match the same fingerprint', async () => {
    // Stored content has already been sanitized once. If a second pass changed
    // the bytes, the database sweep would never recognize its own rows.
    const once = await sanitizeImage(fixture('chain-placeholder.png'), '.png')
    const twice = await sanitizeImage(once, '.png')
    expect(contentFingerprint(twice)).toBe(contentFingerprint(once))
  })
})
