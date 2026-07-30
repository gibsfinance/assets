import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect } from 'vitest'

import { sanitizeImage } from './sanitize'
import {
  contentFingerprint,
  isPlaceholderImage,
  isPlaceholderUri,
  knownPlaceholders,
  placeholderByteLengths,
} from './image-placeholders'

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

describe('isPlaceholderUri', () => {
  it('matches on the filename, not the whole address', () => {
    // The check this replaces compared a bare filename against the full logo
    // address, so it could only ever have matched a list whose logoURI was
    // literally "missing_large.png". None is. It never fired.
    expect(isPlaceholderUri('https://assets.coingecko.com/coins/images/1/large/missing_large.png')).toBe(true)
    expect(isPlaceholderUri('https://assets.coingecko.com/coins/images/9999/thumb/missing_thumb.png')).toBe(true)
    expect(isPlaceholderUri('missing_large.png')).toBe(true)
  })

  it('ignores a query string or fragment after the filename', () => {
    expect(isPlaceholderUri('https://assets.coingecko.com/coins/images/1/large/missing_large.png?v=2')).toBe(true)
    expect(isPlaceholderUri('https://assets.coingecko.com/coins/images/1/large/missing_large.png#a')).toBe(true)
  })

  it('leaves real logo addresses alone', () => {
    expect(isPlaceholderUri('https://assets.coingecko.com/coins/images/1/large/bitcoin.png')).toBe(false)
    // Not a substring match: a coin whose own name contains the word must survive.
    expect(isPlaceholderUri('https://example.test/logos/missing_large_protocol.png')).toBe(false)
    expect(isPlaceholderUri('https://example.test/missing_large.png/real.svg')).toBe(false)
  })

  it('treats an absent address as no address rather than a placeholder', () => {
    expect(isPlaceholderUri(null)).toBe(false)
    expect(isPlaceholderUri(undefined)).toBe(false)
    expect(isPlaceholderUri('')).toBe(false)
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

  it('is not empty', () => {
    // `purgePlaceholderNetworkIcons` builds an IN clause from these lengths, and
    // an empty list would make that clause meaningless. Asserted here rather
    // than branched on at runtime, so emptying the list fails loudly instead of
    // turning the sweep into a no-op nobody notices.
    expect(knownPlaceholders.length).toBeGreaterThan(0)
    expect(placeholderByteLengths.length).toBeGreaterThan(0)
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
