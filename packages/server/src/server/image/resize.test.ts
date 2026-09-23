import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// Mock heavy transitive dependencies so vitest never resolves them
vi.mock('../../db/tables', () => ({ imageMode: { LINK: 'link' } }))

vi.mock('sharp', () => {
  const mockPipeline = {
    resize: vi.fn().mockReturnThis(),
    toFormat: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('resized')),
  }
  return { default: vi.fn(() => mockPipeline) }
})

vi.mock('../../db', () => ({
  getVariant: vi.fn(),
  bumpVariantAccess: vi.fn().mockResolvedValue(undefined),
  insertVariant: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../config', () => ({
  default: { cacheSeconds: 86400 },
}))

import {
  parseResizeParams,
  svgHasViewBox,
  stripRootSvgDimensions,
  cacheControlFor,
  checkRateLimit,
  resetRateLimit,
  extToFormat,
  formatToContentType,
  maybeResize,
  normalizeFormat,
  sendVariant,
} from './resize'
import * as db from '../../db'
import * as path from 'path'
import { submodules } from '../../paths'
import sharp from 'sharp'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Every test in this file shares one process-wide variant budget. Without this
// reset a test spends whatever the tests above it left, so the file passes or
// fails on the order vitest happened to run it in — and a test that exhausts
// the global limit deliberately would starve every test after it.
beforeEach(() => {
  resetRateLimit()
})

function mockReq(query: Record<string, string> = {}): any {
  return { query }
}

function mockRes(): any {
  const res: any = {}
  res.set = vi.fn().mockReturnValue(res)
  res.contentType = vi.fn().mockReturnValue(res)
  res.send = vi.fn().mockReturnValue(res)
  return res
}

function makeImage(
  overrides: Partial<{
    imageHash: string
    content: Buffer
    ext: string
    uri: string
    mode: string
    createdAt: Date
  }> = {},
): any {
  return {
    imageHash: 'abc123',
    content: Buffer.from('fake-image-data'),
    ext: '.png',
    uri: 'https://example.com/image.png',
    mode: 'save',
    createdAt: new Date(),
    ...overrides,
  }
}

describe('parseResizeParams', () => {
  it('returns null when no resize params', () => {
    expect(parseResizeParams({ query: {} })).toBeNull()
    expect(parseResizeParams({ query: { providerKey: 'test' } })).toBeNull()
  })

  it('parses w only', () => {
    expect(parseResizeParams({ query: { w: '72' } })).toEqual({
      w: 72,
      h: null,
      format: null,
      unconvertibleFormat: null,
    })
  })

  it('parses h only', () => {
    expect(parseResizeParams({ query: { h: '64' } })).toEqual({
      w: null,
      h: 64,
      format: null,
      unconvertibleFormat: null,
    })
  })

  it('parses w + h + format', () => {
    expect(parseResizeParams({ query: { w: '72', h: '72', as: 'webp' } })).toEqual({
      w: 72,
      h: 72,
      format: 'webp',
      unconvertibleFormat: null,
    })
  })

  it('normalizes jpeg to jpg', () => {
    expect(parseResizeParams({ query: { as: 'jpeg' } })).toEqual({
      w: null,
      h: null,
      format: 'jpg',
      unconvertibleFormat: null,
    })
  })

  it('rejects invalid dimensions', () => {
    expect(parseResizeParams({ query: { w: '0' } })).toBeNull()
    expect(parseResizeParams({ query: { w: '-1' } })).toBeNull()
    expect(parseResizeParams({ query: { w: '9999' } })).toBeNull()
    expect(parseResizeParams({ query: { w: 'abc' } })).toBeNull()
  })

  it('rejects invalid formats', () => {
    expect(parseResizeParams({ query: { as: 'bmp' } })).toBeNull()
    expect(parseResizeParams({ query: { as: 'tiff' } })).toBeNull()
  })

  it('parses format only', () => {
    expect(parseResizeParams({ query: { as: 'webp' } })).toEqual({
      w: null,
      h: null,
      format: 'webp',
      unconvertibleFormat: null,
    })
  })

  it('accepts boundary dimensions', () => {
    expect(parseResizeParams({ query: { w: '1' } })).toEqual({ w: 1, h: null, format: null, unconvertibleFormat: null })
    expect(parseResizeParams({ query: { w: '2048' } })).toEqual({
      w: 2048,
      h: null,
      format: null,
      unconvertibleFormat: null,
    })
    expect(parseResizeParams({ query: { w: '2049' } })).toBeNull()
  })

  // Path-extension conversion flows through here explicitly — it used to be
  // injected by mutating req.query, which Express 5 discards (non-memoized
  // query getter), so /1/{address}.webp silently served the original format.
  it('derives format from the path extension when ?as= is absent', () => {
    expect(parseResizeParams({ query: {}, pathExt: '.webp' })).toEqual({
      w: null,
      h: null,
      format: 'webp',
      unconvertibleFormat: null,
    })
    expect(parseResizeParams({ query: {}, pathExt: '.jpeg' })).toEqual({
      w: null,
      h: null,
      format: 'jpg',
      unconvertibleFormat: null,
    })
  })

  it('lets an explicit ?as= win over the path extension', () => {
    expect(parseResizeParams({ query: { as: 'png' }, pathExt: '.webp' })).toEqual({
      w: null,
      h: null,
      format: 'png',
      unconvertibleFormat: null,
    })
  })

  it('ignores path extensions outside the convertible set (e.g. .svg served as-is)', () => {
    expect(parseResizeParams({ query: {}, pathExt: '.svg' })).toBeNull()
    expect(parseResizeParams({ query: {}, pathExt: '.gif' })).toBeNull()
  })

  // docs/skills/api-reference.md published `format` as the output-format
  // parameter name before the code ever read it, so requests written against
  // that guide are honoured as a deprecated alias rather than silently
  // ignored (see parseResizeParams' own doc comment).
  it('accepts the deprecated ?format= as an alias for ?as=', () => {
    expect(parseResizeParams({ query: { format: 'webp' } })).toEqual({
      w: null,
      h: null,
      format: 'webp',
      unconvertibleFormat: null,
    })
  })

  it('normalizes jpeg to jpg through the deprecated ?format= alias too', () => {
    expect(parseResizeParams({ query: { format: 'jpeg' } })).toEqual({
      w: null,
      h: null,
      format: 'jpg',
      unconvertibleFormat: null,
    })
  })

  it('lets ?as= win when both ?as= and the deprecated ?format= are present', () => {
    expect(parseResizeParams({ query: { as: 'png', format: 'webp' } })).toEqual({
      w: null,
      h: null,
      format: 'png',
      unconvertibleFormat: null,
    })
  })

  // Whether ?as=svg can be honoured depends on the SOURCE, which this function
  // never sees, so it records the request instead of ruling on it. Deciding here
  // would 404 `/image/1?as=svg`, where the stored image already is an svg and the
  // request is satisfiable — it answers 200 in production today.
  it('records a request for svg rather than rejecting it, since the source decides', () => {
    expect(parseResizeParams({ query: { as: 'svg' } })).toEqual({
      w: null,
      h: null,
      format: null,
      unconvertibleFormat: 'svg',
    })
  })

  it('records it through the deprecated ?format= alias too', () => {
    expect(parseResizeParams({ query: { format: 'svg' } })).toEqual({
      w: null,
      h: null,
      format: null,
      unconvertibleFormat: 'svg',
    })
  })

  it('still carries the dimensions alongside an unconvertible format request', () => {
    // A caller asking for `?w=64&as=svg` against an svg source should get a
    // served image, not a dropped width — the two requests are independent.
    expect(parseResizeParams({ query: { w: '64', as: 'svg' } })).toEqual({
      w: 64,
      h: null,
      format: null,
      unconvertibleFormat: 'svg',
    })
  })

  it('does not throw for a path-extension .svg request (already validated upstream as a real source)', () => {
    expect(parseResizeParams({ query: {}, pathExt: '.svg' })).toBeNull()
  })
})

describe('an unconvertible format request, settled against the source', () => {
  // The decision cannot be made when the query is parsed, only once the stored
  // image is in hand. These two cases are why: the same `?as=svg` is a served
  // image against one source and an honest 404 against the other.
  it('serves a vector source unchanged, because it already is the requested format', async () => {
    const res = mockRes()
    const img = makeImage({ ext: '.svg', content: Buffer.from('<svg viewBox="0 0 32 32"></svg>') })
    const params = parseResizeParams({ query: { as: 'svg' } })

    // false means "not handled here" — the caller then serves the stored bytes,
    // which are the svg the request asked for.
    await expect(maybeResize({ res, img, params })).resolves.toBe(false)
    expect(res.send).not.toHaveBeenCalled()
  })

  it('refuses a raster source with a 404 that names why', async () => {
    const res = mockRes()
    const img = makeImage({ ext: '.png' })
    const params = parseResizeParams({ query: { as: 'svg' } })

    await expect(maybeResize({ res, img, params })).rejects.toMatchObject({ status: 404 })
    // The message has to say what was wrong, not merely that something was: the
    // silent 200 this replaced is what sent an integrator hunting through a
    // JavaScript bundle for an answer.
    await expect(maybeResize({ res, img, params })).rejects.toThrow(/png/)
  })
})

describe('svgHasViewBox', () => {
  it('detects viewBox attribute', () => {
    expect(svgHasViewBox(Buffer.from('<svg viewBox="0 0 24 24"></svg>'))).toBe(true)
    expect(svgHasViewBox(Buffer.from('<svg ViewBox="0 0 24 24"></svg>'))).toBe(true)
    expect(svgHasViewBox(Buffer.from('<svg VIEWBOX="0 0 24 24"></svg>'))).toBe(true)
  })

  it('returns false when no viewBox', () => {
    expect(svgHasViewBox(Buffer.from('<svg width="24" height="24"></svg>'))).toBe(false)
  })

  it('handles empty buffer', () => {
    expect(svgHasViewBox(Buffer.from(''))).toBe(false)
  })

  it('handles buffer shorter than 4096 bytes without viewBox', () => {
    const small = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>')
    expect(small.length).toBeLessThan(4096)
    expect(svgHasViewBox(small)).toBe(false)
  })

  it('handles buffer shorter than 4096 bytes with viewBox', () => {
    const small = Buffer.from('<svg viewBox="0 0 100 100"><circle r="10"/></svg>')
    expect(small.length).toBeLessThan(4096)
    expect(svgHasViewBox(small)).toBe(true)
  })

  it('only reads first 4096 bytes (viewBox beyond limit not detected)', () => {
    const prefix = Buffer.alloc(4096, 'a')
    const suffix = Buffer.from(' viewBox="0 0 100 100"')
    const combined = Buffer.concat([prefix, suffix])
    expect(svgHasViewBox(combined)).toBe(false)
  })
})

describe('stripRootSvgDimensions', () => {
  it('removes width and height from the root element when a viewBox is present', () => {
    const input = Buffer.from(
      '<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"></svg>',
    )
    const output = stripRootSvgDimensions(input).toString('utf8')
    expect(output).not.toMatch(/width=/)
    expect(output).not.toMatch(/height=/)
    // Every other root attribute survives untouched.
    expect(output).toContain('viewBox="0 0 32 32"')
    expect(output).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('leaves width and height untouched when there is no viewBox — stripping would collapse the image', () => {
    const input = Buffer.from('<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"></svg>')
    const output = stripRootSvgDimensions(input).toString('utf8')
    expect(output).toBe(input.toString('utf8'))
  })

  it('never touches width/height on a nested element, only the root', () => {
    const input = Buffer.from('<svg viewBox="0 0 32 32"><image width="32" height="32" href="inner.png"/></svg>')
    const output = stripRootSvgDimensions(input).toString('utf8')
    // The nested <image>'s width/height must survive — only the root <svg> is in scope.
    expect(output).toContain('<image width="32" height="32" href="inner.png"/>')
  })

  it('handles single-quoted attribute values', () => {
    const input = Buffer.from(`<svg width='32' height='32' viewBox='0 0 32 32'></svg>`)
    const output = stripRootSvgDimensions(input).toString('utf8')
    expect(output).not.toMatch(/width=/)
    expect(output).not.toMatch(/height=/)
    expect(output).toContain(`viewBox='0 0 32 32'`)
  })

  it('returns the buffer unchanged when there is no root svg element at all', () => {
    const input = Buffer.from('not an svg document')
    expect(stripRootSvgDimensions(input)).toBe(input)
  })

  it('returns the buffer unchanged when the root tag never closes (truncated content)', () => {
    const input = Buffer.from('<svg width="32" height="32" viewBox="0 0 32 32"')
    expect(stripRootSvgDimensions(input)).toBe(input)
  })

  it('returns the buffer unchanged when the svg element has neither width nor height', () => {
    const input = Buffer.from('<svg viewBox="0 0 32 32"><circle r="10"/></svg>')
    expect(stripRootSvgDimensions(input).toString('utf8')).toBe(input.toString('utf8'))
  })
})

describe('cacheControlFor', () => {
  it('serves a year-long, immutable header for content-addressed responses', () => {
    expect(cacheControlFor('content-addressed')).toBe('public, max-age=31536000, immutable')
  })

  it('serves the configured, shorter lifetime for a mutable address', () => {
    expect(cacheControlFor('mutable')).toBe('public, max-age=86400')
  })
})

describe('extToFormat', () => {
  it('maps common extensions to sharp format names', () => {
    expect(extToFormat('.png')).toBe('png')
    expect(extToFormat('.jpg')).toBe('jpeg')
    expect(extToFormat('.jpeg')).toBe('jpeg')
    expect(extToFormat('.webp')).toBe('webp')
    expect(extToFormat('.avif')).toBe('avif')
  })

  it('maps SVG to PNG (rasterization)', () => {
    expect(extToFormat('.svg')).toBe('png')
    expect(extToFormat('.svg+xml')).toBe('png')
  })

  it('defaults unknown formats to PNG', () => {
    expect(extToFormat('.bmp')).toBe('png')
    expect(extToFormat('.tiff')).toBe('png')
  })

  it('works without leading dot', () => {
    expect(extToFormat('png')).toBe('png')
    expect(extToFormat('jpg')).toBe('jpeg')
    expect(extToFormat('jpeg')).toBe('jpeg')
    expect(extToFormat('webp')).toBe('webp')
    expect(extToFormat('avif')).toBe('avif')
    expect(extToFormat('svg')).toBe('png')
    expect(extToFormat('svg+xml')).toBe('png')
    expect(extToFormat('bmp')).toBe('png')
  })
})

describe('formatToContentType', () => {
  it('maps formats to content types', () => {
    expect(formatToContentType('webp')).toBe('image/webp')
    expect(formatToContentType('png')).toBe('image/png')
    expect(formatToContentType('jpg')).toBe('image/jpeg')
    expect(formatToContentType('avif')).toBe('image/avif')
  })

  it('falls back to application/octet-stream for unknown formats', () => {
    expect(formatToContentType('bmp')).toBe('application/octet-stream')
    expect(formatToContentType('tiff')).toBe('application/octet-stream')
    expect(formatToContentType('')).toBe('application/octet-stream')
    expect(formatToContentType('jpeg')).toBe('application/octet-stream')
  })
})

describe('checkRateLimit', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows up to 5 inserts per image', () => {
    const hash = 'test-per-image-' + Date.now()
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(hash)).toBe(true)
    }
    expect(checkRateLimit(hash)).toBe(false)
  })

  it('separate images have separate limits', () => {
    const hash1 = 'test-separate-1-' + Date.now()
    const hash2 = 'test-separate-2-' + Date.now()
    for (let i = 0; i < 5; i++) checkRateLimit(hash1)
    expect(checkRateLimit(hash1)).toBe(false)
    expect(checkRateLimit(hash2)).toBe(true) // different image, still has budget
  })

  it('enforces global limit of 100 across different image hashes', () => {
    // Use fake timers so no windows expire during this test
    vi.useFakeTimers()
    const base = 'global-limit-test-' + Date.now()
    // Each unique hash gets 5 slots: 20 hashes × 5 = 100 total
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 5; j++) {
        checkRateLimit(`${base}-${i}`)
      }
    }
    // The 101st call on any new hash should be blocked by the global limit
    expect(checkRateLimit(`${base}-new`)).toBe(false)
  })

  it('resets per-image window after WINDOW_MS elapses', () => {
    vi.useFakeTimers()
    const hash = 'test-window-reset-' + Date.now()

    // Exhaust the per-image limit
    for (let i = 0; i < 5; i++) checkRateLimit(hash)
    expect(checkRateLimit(hash)).toBe(false)

    // Advance past the 60-second window
    vi.advanceTimersByTime(61_000)

    // Should be allowed again after window resets
    expect(checkRateLimit(hash)).toBe(true)
  })

  it('resets global window after WINDOW_MS elapses', () => {
    // Pin time to a known epoch so the global window initialises at T=0
    const T0 = 2_000_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(T0)

    const base = 'global-reset-' + T0

    // Fill 100 slots within the window starting at T0
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 5; j++) checkRateLimit(`${base}-${i}`)
    }

    // Confirm the global limit is now hit
    expect(checkRateLimit(`${base}-blocked`)).toBe(false)

    // Advance past the 60-second global window — global counter should reset
    vi.setSystemTime(T0 + 61_000)

    expect(checkRateLimit(`${base}-reset`)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// maybeResize + sendVariant
// ---------------------------------------------------------------------------

describe('maybeResize', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Default: no cached variant
    vi.mocked(db.getVariant).mockResolvedValue(undefined as any)
    vi.mocked(db.bumpVariantAccess).mockResolvedValue(undefined as any)
    vi.mocked(db.insertVariant).mockResolvedValue(undefined as any)

    // Re-wire the sharp mock pipeline after resetAllMocks
    const mockPipeline = {
      resize: vi.fn().mockReturnThis(),
      toFormat: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('resized')),
    }
    vi.mocked(sharp).mockReturnValue(mockPipeline as any)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // 1. Returns false when no resize params
  // -------------------------------------------------------------------------
  it('returns false when query has no w, h, or format', async () => {
    const req = mockReq({})
    const res = mockRes()
    const img = makeImage()

    const result = await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    expect(result).toBe(false)
    expect(res.send).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 2. Returns true and serves cached variant when one exists in DB
  // -------------------------------------------------------------------------
  it('serves cached variant from DB and returns true', async () => {
    const cachedVariant = {
      imageHash: 'abc123',
      width: 72,
      height: 72,
      format: 'webp',
      content: Buffer.from('cached'),
      accessCount: 5,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    }
    vi.mocked(db.getVariant).mockResolvedValue(cachedVariant as any)

    const req = mockReq({ w: '72', h: '72', as: 'webp' })
    const res = mockRes()
    const img = makeImage()

    const result = await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    expect(result).toBe(true)
    expect(db.getVariant).toHaveBeenCalledWith('abc123', 72, 72, 'webp')
    expect(db.bumpVariantAccess).toHaveBeenCalledWith('abc123', 72, 72, 'webp')
    expect(sharp).not.toHaveBeenCalled()
    expect(res.send).toHaveBeenCalledWith(cachedVariant.content)
  })

  // -------------------------------------------------------------------------
  // 3. Returns true and resizes with sharp on cache miss
  // -------------------------------------------------------------------------
  it('resizes with sharp on cache miss and returns true', async () => {
    vi.mocked(db.getVariant).mockResolvedValue(undefined as any)

    const req = mockReq({ w: '72', h: '72', as: 'webp' })
    const res = mockRes()
    const img = makeImage()

    const result = await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    expect(result).toBe(true)
    expect(sharp).toHaveBeenCalledWith(img.content)
    expect(res.send).toHaveBeenCalledWith(Buffer.from('resized'))
  })

  // -------------------------------------------------------------------------
  // 4. Returns false for SVG with viewBox and no explicit format conversion
  // -------------------------------------------------------------------------
  it('returns false for SVG with viewBox when no format is requested', async () => {
    const req = mockReq({ w: '72' })
    const res = mockRes()
    const img = makeImage({
      ext: '.svg',
      content: Buffer.from('<svg viewBox="0 0 24 24"><path/></svg>'),
    })

    const result = await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    expect(result).toBe(false)
    expect(res.send).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 5. Resizes SVG without viewBox (falls through to sharp)
  // -------------------------------------------------------------------------
  it('resizes SVG without viewBox', async () => {
    const req = mockReq({ w: '72' })
    const res = mockRes()
    const img = makeImage({
      ext: '.svg',
      content: Buffer.from('<svg width="24" height="24"><path/></svg>'),
    })

    const result = await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    expect(result).toBe(true)
    expect(sharp).toHaveBeenCalled()
    expect(res.send).toHaveBeenCalledWith(Buffer.from('resized'))
  })

  // -------------------------------------------------------------------------
  // 6. Format-only conversion (no w/h) — uses 0x0 sentinel
  // -------------------------------------------------------------------------
  it('performs format-only conversion using 0x0 sentinel', async () => {
    const req = mockReq({ as: 'webp' })
    const res = mockRes()
    const img = makeImage()

    const result = await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    expect(result).toBe(true)
    expect(db.getVariant).toHaveBeenCalledWith('abc123', 0, 0, 'webp')

    // sharp pipeline should NOT call resize for format-only
    const pipeline = vi.mocked(sharp).mock.results[0].value
    expect(pipeline.resize).not.toHaveBeenCalled()
    expect(pipeline.toFormat).toHaveBeenCalledWith('webp')

    // x-resize header should be 'transcoded'
    expect(res.set).toHaveBeenCalledWith('x-resize', 'transcoded')
  })

  // -------------------------------------------------------------------------
  // 7. Handles LINK-mode images (fetches remote content)
  // -------------------------------------------------------------------------
  it('fetches remote content for LINK-mode images', async () => {
    const fakeContent = Buffer.from('remote-image-data')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(fakeContent.buffer),
    }) as any

    const req = mockReq({ w: '72' })
    const res = mockRes()
    const img = makeImage({
      mode: 'link',
      content: Buffer.from(''),
      uri: 'https://cdn.example.com/token.png',
    })

    const result = await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    expect(result).toBe(true)
    expect(global.fetch).toHaveBeenCalledWith(
      'https://cdn.example.com/token.png',
      expect.objectContaining({ signal: expect.anything() }),
    )
    expect(sharp).toHaveBeenCalledWith(expect.any(Buffer))
  })

  it('will not fetch a link-only host in order to resize it', async () => {
    // A resize is a derivative, and a link-only host's terms forbid a derivative as
    // firmly as a copy. Fetching the bytes here purely to transcode them would be
    // exactly what the storage path already refuses to do, so this declines the same
    // way an unfetchable image does and lets the caller redirect to the source.
    global.fetch = vi.fn() as never
    const req = mockReq({ w: '72' })
    const res = mockRes()
    const img = makeImage({
      mode: 'link',
      content: Buffer.from(''),
      uri: 'https://static.debank.com/image/eth_token/logo_url/0xabc/1d039016.png',
    })

    const result = await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    expect(result).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(res.send).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 8. Returns false for LINK-mode with non-http URI
  // -------------------------------------------------------------------------
  it('returns false for LINK-mode with non-http URI', async () => {
    const req = mockReq({ w: '72' })
    const res = mockRes()
    const img = makeImage({
      mode: 'link',
      content: Buffer.from(''),
      uri: 'ipfs://QmSomeCid',
    })

    const result = await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    expect(result).toBe(false)
    expect(res.send).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 9. Returns false for LINK-mode when fetch fails
  // -------------------------------------------------------------------------
  it('returns false when remote fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
    }) as any

    const req = mockReq({ w: '72' })
    const res = mockRes()
    const img = makeImage({
      mode: 'link',
      content: Buffer.from(''),
      uri: 'https://cdn.example.com/bad.png',
    })

    const result = await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    expect(result).toBe(false)
    expect(res.send).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 9b. Returns false when remote fetch throws
  // -------------------------------------------------------------------------
  it('returns false when remote fetch throws an exception', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error')) as any

    const req = mockReq({ w: '72' })
    const res = mockRes()
    const img = makeImage({
      mode: 'link',
      content: Buffer.from(''),
      uri: 'https://cdn.example.com/timeout.png',
    })

    const result = await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    expect(result).toBe(false)
  })

  // -------------------------------------------------------------------------
  // 10. Calls insertVariant only when rate limit allows
  // -------------------------------------------------------------------------
  it('calls insertVariant when rate limit allows', async () => {
    // Use a unique hash so rate limit is fresh
    const req = mockReq({ w: '72', as: 'webp' })
    const res = mockRes()
    const img = makeImage({ imageHash: 'insert-allowed-' + Date.now() })

    await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    // Give microtasks a chance to settle
    await vi.waitFor(() => expect(db.insertVariant).toHaveBeenCalled())
  })

  // -------------------------------------------------------------------------
  // A failed cache-write must not crash the request that already served the
  // resized bytes — the fire-and-forget insertVariant().catch() is the only
  // thing standing between a transient database error and an unhandled
  // rejection tearing down the process.
  // -------------------------------------------------------------------------
  it('does not reject the response when the fire-and-forget insertVariant write fails', async () => {
    vi.mocked(db.insertVariant).mockRejectedValueOnce(new Error('insert failed'))
    const req = mockReq({ w: '72', as: 'webp' })
    const res = mockRes()
    const img = makeImage({ imageHash: 'insert-fails-' + Date.now() })

    await expect(maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })).resolves.toBe(true)

    // The catch handler runs asynchronously after the response is already sent —
    // wait for it so the rejection is observed as handled, not left dangling.
    await vi.waitFor(() => expect(db.insertVariant).toHaveBeenCalled())
  })

  // -------------------------------------------------------------------------
  // Same guarantee on the cache-hit path — a stale-access-bump failure must
  // not block or crash the response that already served the cached variant.
  // -------------------------------------------------------------------------
  it('does not reject the response when the fire-and-forget bumpVariantAccess write fails', async () => {
    const cachedVariant = {
      imageHash: 'abc123',
      width: 72,
      height: 72,
      format: 'webp',
      content: Buffer.from('cached'),
      accessCount: 5,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    }
    vi.mocked(db.getVariant).mockResolvedValue(cachedVariant as any)
    vi.mocked(db.bumpVariantAccess).mockRejectedValueOnce(new Error('bump failed'))

    const req = mockReq({ w: '72', h: '72', as: 'webp' })
    const res = mockRes()
    const img = makeImage()

    const result = await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })
    expect(result).toBe(true)

    await vi.waitFor(() => expect(db.bumpVariantAccess).toHaveBeenCalled())
  })

  // -------------------------------------------------------------------------
  // 11. Skips insertVariant when rate limit is exhausted
  // -------------------------------------------------------------------------
  it('skips insertVariant when rate limit is exhausted', async () => {
    vi.useFakeTimers()
    const hash = 'rate-limited-' + Date.now()
    // Exhaust per-image limit (5 inserts)
    for (let i = 0; i < 5; i++) {
      checkRateLimit(hash)
    }

    const req = mockReq({ w: '72', as: 'webp' })
    const res = mockRes()
    const img = makeImage({ imageHash: hash })

    await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    // insertVariant should NOT have been called (rate-limited)
    expect(db.insertVariant).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // normalizeFormat: jpg → jpeg for sharp
  // -------------------------------------------------------------------------
  it('passes jpeg to sharp.toFormat when format=jpg is requested', async () => {
    const req = mockReq({ as: 'jpg' })
    const res = mockRes()
    const img = makeImage({ imageHash: 'normalize-jpg-' + Date.now() })

    await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    const pipeline = vi.mocked(sharp).mock.results[0].value
    expect(pipeline.toFormat).toHaveBeenCalledWith('jpeg')
  })

  // -------------------------------------------------------------------------
  // Line 174: targetH falsy → resize receives (undefined, h, ...)
  // -------------------------------------------------------------------------
  it('passes undefined for missing width when only height is requested', async () => {
    vi.mocked(db.getVariant).mockResolvedValue(null as any)
    const req = mockReq({ h: '100' })
    const res = mockRes()
    await maybeResize({ res, img: makeImage(), params: parseResizeParams({ query: req.query }) })
    expect(sharp).toHaveBeenCalled()
    const pipeline = (sharp as unknown as ReturnType<typeof vi.fn>).mock.results[0].value
    expect(pipeline.resize).toHaveBeenCalledWith(undefined, 100, expect.any(Object))
  })

  // -------------------------------------------------------------------------
  // Line 174: targetW falsy → resize receives (w, undefined, ...)
  // -------------------------------------------------------------------------
  it('passes undefined for missing height when only width is requested', async () => {
    vi.mocked(db.getVariant).mockResolvedValue(null as any)
    const req = mockReq({ w: '100' })
    const res = mockRes()
    await maybeResize({ res, img: makeImage(), params: parseResizeParams({ query: req.query }) })
    const pipeline = (sharp as unknown as ReturnType<typeof vi.fn>).mock.results[0].value
    expect(pipeline.resize).toHaveBeenCalledWith(100, undefined, expect.any(Object))
  })
})

// ---------------------------------------------------------------------------
// sendVariant (tested indirectly via maybeResize cache-hit path)
// ---------------------------------------------------------------------------

describe('sendVariant (via maybeResize)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(db.bumpVariantAccess).mockResolvedValue(undefined as any)

    const mockPipeline = {
      resize: vi.fn().mockReturnThis(),
      toFormat: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('resized')),
    }
    vi.mocked(sharp).mockReturnValue(mockPipeline as any)
  })

  function makeVariant(
    overrides: Partial<{
      imageHash: string
      width: number
      height: number
      format: string
      content: Buffer
      accessCount: number
      createdAt: Date
      lastAccessedAt: Date
    }> = {},
  ): any {
    return {
      imageHash: 'abc123',
      width: 72,
      height: 72,
      format: 'webp',
      content: Buffer.from('cached'),
      accessCount: 1,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      ...overrides,
    }
  }

  it('sets cache-control header with configured cacheSeconds', async () => {
    vi.mocked(db.getVariant).mockResolvedValue(makeVariant())
    const req = mockReq({ w: '72', h: '72', as: 'webp' })
    const res = mockRes()
    await maybeResize({ res, img: makeImage(), params: parseResizeParams({ query: req.query }) })
    expect(res.set).toHaveBeenCalledWith('cache-control', 'public, max-age=86400')
  })

  // ---------------------------------------------------------------------
  // Content-addressed caching (cache-hit path): a resized/transcoded variant
  // of a hash-addressed image is exactly as immutable as the original — the
  // hash names the source bytes, and the variant is a pure function of them.
  // ---------------------------------------------------------------------
  it('serves a cached variant with the immutable, year-long cache-control when cachePolicy is content-addressed', async () => {
    vi.mocked(db.getVariant).mockResolvedValue(makeVariant())
    const req = mockReq({ w: '72', h: '72', as: 'webp' })
    const res = mockRes()
    await maybeResize({
      res,
      img: makeImage(),
      params: parseResizeParams({ query: req.query }),
      cachePolicy: 'content-addressed',
    })
    expect(res.set).toHaveBeenCalledWith('cache-control', 'public, max-age=31536000, immutable')
  })

  // Cache-miss path — the variant is created fresh via sharp rather than read
  // back from image_variant, so the cache-control decision must be threaded
  // through that branch too, not just the cache-hit branch above.
  it('serves a newly-created variant with the immutable cache-control when cachePolicy is content-addressed', async () => {
    vi.mocked(db.getVariant).mockResolvedValue(undefined as any)
    vi.mocked(db.insertVariant).mockResolvedValue(undefined as any)
    const req = mockReq({ w: '72', h: '72', as: 'webp' })
    const res = mockRes()
    await maybeResize({
      res,
      img: makeImage(),
      params: parseResizeParams({ query: req.query }),
      cachePolicy: 'content-addressed',
    })
    expect(res.set).toHaveBeenCalledWith('cache-control', 'public, max-age=31536000, immutable')
  })

  it('defaults to the mutable cache-control when cachePolicy is omitted, even on a newly-created variant', async () => {
    vi.mocked(db.getVariant).mockResolvedValue(undefined as any)
    vi.mocked(db.insertVariant).mockResolvedValue(undefined as any)
    const req = mockReq({ w: '72', h: '72', as: 'webp' })
    const res = mockRes()
    await maybeResize({ res, img: makeImage(), params: parseResizeParams({ query: req.query }) })
    expect(res.set).toHaveBeenCalledWith('cache-control', 'public, max-age=86400')
  })

  it('sets x-resize header with WxH dimensions', async () => {
    vi.mocked(db.getVariant).mockResolvedValue(makeVariant({ width: 72, height: 72 }))
    const req = mockReq({ w: '72', h: '72', as: 'webp' })
    const res = mockRes()
    await maybeResize({ res, img: makeImage(), params: parseResizeParams({ query: req.query }) })
    expect(res.set).toHaveBeenCalledWith('x-resize', '72x72')
  })

  it('sets x-resize as "transcoded" for 0x0 format-only variants', async () => {
    vi.mocked(db.getVariant).mockResolvedValue(makeVariant({ width: 0, height: 0 }))
    const req = mockReq({ as: 'webp' })
    const res = mockRes()
    await maybeResize({ res, img: makeImage(), params: parseResizeParams({ query: req.query }) })
    expect(res.set).toHaveBeenCalledWith('x-resize', 'transcoded')
  })

  it('sets x-uri for http URIs', async () => {
    vi.mocked(db.getVariant).mockResolvedValue(makeVariant())
    const req = mockReq({ w: '72', as: 'webp' })
    const res = mockRes()
    const img = makeImage({ uri: 'https://cdn.example.com/img.png' })
    await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })
    expect(res.set).toHaveBeenCalledWith('x-uri', 'https://cdn.example.com/img.png')
  })

  it('sets x-uri for ipfs URIs', async () => {
    vi.mocked(db.getVariant).mockResolvedValue(makeVariant())
    const req = mockReq({ w: '72', as: 'webp' })
    const res = mockRes()
    const img = makeImage({ uri: 'ipfs://QmSomeCid' })
    await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })
    expect(res.set).toHaveBeenCalledWith('x-uri', 'ipfs://QmSomeCid')
  })

  it('omits x-uri for non-http/ipfs URIs', async () => {
    vi.mocked(db.getVariant).mockResolvedValue(makeVariant())
    const req = mockReq({ w: '72', as: 'webp' })
    const res = mockRes()
    const img = makeImage({ uri: 'data:image/png;base64,abc' })
    await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })
    const setCalls = vi.mocked(res.set).mock.calls.map((c: any[]) => c[0])
    expect(setCalls).not.toContain('x-uri')
  })

  it('sets correct content type via contentType()', async () => {
    vi.mocked(db.getVariant).mockResolvedValue(makeVariant({ format: 'webp' }))
    const req = mockReq({ w: '72', as: 'webp' })
    const res = mockRes()
    await maybeResize({ res, img: makeImage(), params: parseResizeParams({ query: req.query }) })
    expect(res.contentType).toHaveBeenCalledWith('image/webp')
  })

  // -------------------------------------------------------------------------
  // Line 212: uri falsy → x-uri header must not be set
  // -------------------------------------------------------------------------
  it('omits x-uri header entirely when uri is undefined', async () => {
    vi.mocked(db.getVariant).mockResolvedValue(makeVariant())
    const req = mockReq({ w: '72', as: 'webp' })
    const res = mockRes()
    const img = makeImage({ uri: undefined })
    await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })
    const setCalls = vi.mocked(res.set).mock.calls.map((c: any[]) => c[0])
    expect(setCalls).not.toContain('x-uri')
  })

  // -------------------------------------------------------------------------
  // Regression: this is the live bug the task describes. Before the fix,
  // sendVariant() only recognised `http`/`ipfs` uris — a relative submodule
  // filesystem path fell through the `if` untouched and no attribution header
  // was ever set on a resized/transcoded response, even though the very same
  // image served at full size (via sendImage) carried its x-uri correctly.
  // `curl -I '.../image/1?w=64&as=webp'` returned no x-uri while
  // `curl -I '.../image/1'` returned one. Both must now agree.
  // -------------------------------------------------------------------------
  it('carries attribution for a resized image whose source is a relative submodule path', async () => {
    vi.mocked(db.getVariant).mockResolvedValue(makeVariant())
    const req = mockReq({ w: '72', as: 'webp' })
    const res = mockRes()
    const absoluteSubmodulePath = path.join(submodules, 'smoldapp-tokenassets', 'chains', '1', 'logo.svg')
    const img = makeImage({ uri: absoluteSubmodulePath })

    await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    expect(res.set).toHaveBeenCalledWith('x-source-uri', 'smoldapp-tokenassets/chains/1/logo.svg')
    expect(res.set).toHaveBeenCalledWith('x-uri', 'smoldapp-tokenassets/chains/1/logo.svg')
    expect(res.set).toHaveBeenCalledWith('x-provider', 'smoldapp')
    expect(res.set).toHaveBeenCalledWith('x-license', 'MIT')
    expect(res.set).toHaveBeenCalledWith('x-attribution', 'Copyright (c) 2024 Smol - MIT')
  })

  it("threads the list_token's precomputed effective licence into a resized response", async () => {
    vi.mocked(db.getVariant).mockResolvedValue(makeVariant())
    const req = mockReq({ w: '72', as: 'webp' })
    const res = mockRes()
    const img = {
      ...makeImage({ uri: 'https://cdn.unrelated-host.example/logo.png' }),
      providerKey: 'some-provider',
      license: 'Apache-2.0',
      listLicense: 'Apache-2.0',
      listLicenseUrl: 'https://example.test/apache',
      listAttribution: 'Example Corp',
    }

    await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    expect(res.set).toHaveBeenCalledWith('x-license', 'Apache-2.0')
    expect(res.set).toHaveBeenCalledWith('x-license-url', 'https://example.test/apache')
    expect(res.set).toHaveBeenCalledWith('x-attribution', 'Example Corp')
  })

  it('names the recorded provider but withholds a licence the address cannot confirm', async () => {
    vi.mocked(db.getVariant).mockResolvedValue(makeVariant())
    const req = mockReq({ w: '72', as: 'webp' })
    const res = mockRes()
    // A link-mode row could carry a provider key with a uri that names no
    // recognisable source (e.g. a bare CDN host) — this is the ethereum-lists
    // defect: its own repository holds no images, and ethereum-lists entries'
    // real image addresses are exactly this shape (an arbitrary external
    // host). The provider key alone must never grant that provider's licence.
    const img = { ...makeImage({ uri: 'https://cdn.unknown-host.example/icon.png' }), providerKey: 'ethereum-lists' }

    await maybeResize({ res, img, params: parseResizeParams({ query: req.query }) })

    expect(res.set).toHaveBeenCalledWith('x-provider', 'ethereum-lists')
    expect(res.set).toHaveBeenCalledWith('x-license', 'unknown')
    expect(res.set).not.toHaveBeenCalledWith('x-attribution', expect.any(String))
  })
})

// ---------------------------------------------------------------------------
// cleanExpiredWindows — triggered when perImageWindows.size > 1000
// ---------------------------------------------------------------------------

describe('normalizeFormat', () => {
  it('converts jpg to jpeg', () => {
    expect(normalizeFormat('jpg')).toBe('jpeg')
  })

  it('passes through non-jpg formats unchanged', () => {
    expect(normalizeFormat('webp')).toBe('webp')
    expect(normalizeFormat('png')).toBe('png')
    expect(normalizeFormat('avif')).toBe('avif')
    expect(normalizeFormat('jpeg')).toBe('jpeg')
  })
})

describe('sendVariant (direct)', () => {
  it('sets headers and sends content', () => {
    const res = mockRes()
    sendVariant(
      res,
      {
        imageHash: 'abc',
        width: 72,
        height: 72,
        format: 'webp',
        content: Buffer.from('test'),
        accessCount: 1,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      },
      { uri: 'https://example.com/img.png' },
    )

    expect(res.set).toHaveBeenCalledWith('cache-control', expect.stringContaining('max-age='))
    expect(res.set).toHaveBeenCalledWith('x-resize', '72x72')
    expect(res.set).toHaveBeenCalledWith('x-uri', 'https://example.com/img.png')
    expect(res.contentType).toHaveBeenCalledWith('image/webp')
    expect(res.send).toHaveBeenCalled()
  })

  it('sets the immutable, year-long cache-control when cachePolicy is content-addressed', () => {
    const res = mockRes()
    sendVariant(
      res,
      {
        imageHash: 'abc',
        width: 72,
        height: 72,
        format: 'webp',
        content: Buffer.from('test'),
        accessCount: 1,
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      },
      { cachePolicy: 'content-addressed' },
    )
    expect(res.set).toHaveBeenCalledWith('cache-control', 'public, max-age=31536000, immutable')
  })

  it('defaults to no uri/providerKey when called without an options argument', () => {
    const res = mockRes()
    sendVariant(res, {
      imageHash: 'abc',
      width: 0,
      height: 0,
      format: 'webp',
      content: Buffer.from('test'),
      accessCount: 1,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    })

    const setCalls = vi.mocked(res.set).mock.calls.map((c: any[]) => c[0])
    expect(setCalls).not.toContain('x-uri')
    expect(setCalls).not.toContain('x-provider')
    expect(res.set).toHaveBeenCalledWith('x-license', 'unknown')
  })
})

describe('cleanExpiredWindows (triggered via checkRateLimit)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('deletes expired entries from the map during cleanup', () => {
    vi.useFakeTimers()
    const T0 = 4_000_000_000_000
    vi.setSystemTime(T0)
    const base = 'cleanup-' + T0

    // The global window allows 100 calls per 60-second period. To insert
    // >1000 entries we must advance >60s between batches to reset the global
    // window. Each batch uses 100 unique hashes that get stored in the map.
    const BATCH_INTERVAL = 61_000
    for (let batch = 0; batch < 11; batch++) {
      vi.setSystemTime(T0 + batch * BATCH_INTERVAL)
      for (let j = 0; j < 100; j++) {
        checkRateLimit(`${base}-${batch * 100 + j}`)
      }
    }
    // Map now has 1100 entries. Entries from batches 0-9 are older than 60s
    // relative to the latest batch; batch 10 entries are current.

    // Advance past 60s from the last batch so ALL entries are expired.
    vi.setSystemTime(T0 + 11 * BATCH_INTERVAL)

    // One more call triggers cleanExpiredWindows() because size > 1000.
    // The loop body (lines 86-89) deletes every expired entry.
    const result = checkRateLimit(`${base}-trigger`)
    expect(result).toBe(true)

    // Verify cleanup happened: a hash from batch 0 was deleted, so calling
    // it again creates a fresh window and returns true.
    expect(checkRateLimit(`${base}-0`)).toBe(true)
  })
})
