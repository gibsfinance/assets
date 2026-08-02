import { describe, it, expect } from 'vitest'
import { SIZE_BUCKETS, toSizeBucket, sizedImageUrl } from './image-size'

const imageEndpoint = 'https://gib.show/image/'

// ---------------------------------------------------------------------------
// toSizeBucket
// ---------------------------------------------------------------------------
describe('toSizeBucket', () => {
  // Every icon would look soft on a retina display if we asked for exactly the
  // layout size, which is the reason to request at all.
  it('asks for at least twice the layout size', () => {
    expect(toSizeBucket(24)).toBeGreaterThanOrEqual(48)
    expect(toSizeBucket(64)).toBeGreaterThanOrEqual(128)
  })

  it('always returns a bucket', () => {
    for (const size of [1, 14, 20, 24, 28, 40, 48, 64, 96]) {
      expect(SIZE_BUCKETS).toContain(toSizeBucket(size) as (typeof SIZE_BUCKETS)[number])
    }
  })

  // The server caches one variant per size. Nearby call sites must land on the same
  // bucket or each one warms its own variant and none of them stay warm.
  it('collapses nearby sizes onto a shared bucket', () => {
    expect(toSizeBucket(20)).toBe(toSizeBucket(24))
    expect(toSizeBucket(28)).toBe(toSizeBucket(32))
  })

  it('caps at the largest bucket rather than requesting the original', () => {
    expect(toSizeBucket(4000)).toBe(SIZE_BUCKETS[SIZE_BUCKETS.length - 1])
  })
})

// ---------------------------------------------------------------------------
// sizedImageUrl
// ---------------------------------------------------------------------------
describe('sizedImageUrl', () => {
  it('adds width, height, and format to an image endpoint URL', () => {
    const url = sizedImageUrl({
      url: 'https://gib.show/image/eip155-1',
      width: 24,
      height: 24,
      imageEndpoint,
    })
    expect(url).toBe('https://gib.show/image/eip155-1?w=48&h=48&as=webp')
  })

  it('preserves existing unrelated query params', () => {
    const url = sizedImageUrl({
      url: 'https://gib.show/image/eip155-1/0xabc?only=vector',
      width: 24,
      height: 24,
      imageEndpoint,
    })
    expect(url).toContain('only=vector')
    expect(url).toContain('w=48')
  })

  it('sizes width and height independently', () => {
    const url = sizedImageUrl({
      url: 'https://gib.show/image/eip155-1',
      width: 24,
      height: 64,
      imageEndpoint,
    })
    expect(url).toBe('https://gib.show/image/eip155-1?w=48&h=128&as=webp')
  })

  // An upstream logoURI or a data URI is not ours to reshape, and appending params
  // to a signed or extension-sensitive URL can break the fetch outright.
  it('leaves URLs outside the image endpoint alone', () => {
    const foreign = 'https://raw.githubusercontent.com/org/repo/logo.png'
    expect(sizedImageUrl({ url: foreign, width: 24, height: 24, imageEndpoint })).toBe(foreign)

    const dataUri = 'data:image/png;base64,iVBORw0KGgo='
    expect(sizedImageUrl({ url: dataUri, width: 24, height: 24, imageEndpoint })).toBe(dataUri)
  })

  // The token image manager renders one preview per size and states each in the URL.
  // Overwriting that would make every preview identical.
  it.each(['w=16', 'h=16', 'as=png'])('defers to a caller that already stated %s', (param) => {
    const stated = `https://gib.show/image/eip155-1/0xabc?${param}`
    expect(sizedImageUrl({ url: stated, width: 24, height: 24, imageEndpoint })).toBe(stated)
  })
})
