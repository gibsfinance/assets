/**
 * Tests for the limits and failure handling around plated images: how large one may be drawn, how
 * many are drawn at once and how often, what happens to a source that cannot be decoded, and what a
 * response says about how long it may be cached. sharp is real; only the database, configuration and
 * the log are replaced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'

vi.mock('../../db/tables', () => ({ imageMode: { LINK: 'link' } }))
vi.mock('../../db', () => ({
  getVariant: vi.fn().mockResolvedValue(undefined),
  bumpVariantAccess: vi.fn().mockResolvedValue(undefined),
  insertVariant: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../../config', () => ({ default: { cacheSeconds: 86400, plateRenders: { concurrency: 2 } } }))
vi.mock('@gibs/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gibs/utils')>()),
  failureLog: vi.fn(),
}))

import { failureLog } from '@gibs/utils'
import {
  maybeResize,
  openForMeasurement,
  openSource,
  parseResizeParams,
  formatToContentType,
  extToFormat,
  resetRateLimit,
  type CachePolicy,
} from './resize'
import { createRateLimiter, type RateLimiter } from './rate-limit'
import { createConcurrencyGate, type ConcurrencyGate } from './concurrency-gate'

const cronosSvg = readFileSync(new URL('./__fixtures__/cronos-web3icons.svg', import.meta.url))
const ethereumSvg = readFileSync(new URL('./__fixtures__/ethereum-smoldapp.svg', import.meta.url))
const garbage = Buffer.from('this is not an image, whatever the extension says. '.repeat(10))

const solid = (side: number, background: string, format: 'png' | 'jpeg' = 'png') =>
  sharp({ create: { width: side, height: side, channels: 3, background } })
    .toFormat(format)
    .toBuffer()

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimit()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

interface Sent {
  handled: boolean
  body: Buffer | null
  contentType: string | null
  headers: Record<string, string>
  status: number | null
  json: unknown
}

async function request(options: {
  content: Buffer
  ext: string
  query: Record<string, string>
  imageHash?: string
  cachePolicy?: CachePolicy
  plateGate?: ConcurrencyGate
  plateLimiter?: RateLimiter
  extra?: Record<string, unknown>
}): Promise<Sent> {
  const headers: Record<string, string> = {}
  const sent: Sent = { handled: false, body: null, contentType: null, headers, status: null, json: null }
  const res: any = {}
  res.set = vi.fn((name: string, value: string) => {
    headers[name] = value
    return res
  })
  res.contentType = vi.fn((type: string) => {
    sent.contentType = type
    return res
  })
  res.send = vi.fn((body: Buffer) => {
    sent.body = body
    return res
  })
  res.status = vi.fn((code: number) => {
    sent.status = code
    return res
  })
  res.json = vi.fn((payload: unknown) => {
    sent.json = payload
    return res
  })
  const img: any = {
    imageHash: options.imageHash ?? `hash-${Math.random()}`,
    content: options.content,
    ext: options.ext,
    uri: 'https://example.com/logo',
    mode: 'save',
    ...options.extra,
  }
  sent.handled = await maybeResize({
    res,
    img,
    params: parseResizeParams({ query: options.query }),
    cachePolicy: options.cachePolicy,
    plateGate: options.plateGate,
    plateLimiter: options.plateLimiter,
  })
  return sent
}

describe('a jpg is served as image/jpeg (finding 4)', () => {
  it('maps every format extToFormat can answer to an image type', () => {
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.svg', '.bmp']) {
      expect(formatToContentType(extToFormat(ext))).toMatch(/^image\//)
    }
    expect(formatToContentType('jpeg')).toBe('image/jpeg')
  })
  it('serves a plain ?w= resize of a jpg as image/jpeg', async () => {
    const sent = await request({ content: await solid(100, '#336699', 'jpeg'), ext: '.jpg', query: { w: '40' } })
    expect(sent.contentType).toBe('image/jpeg')
    expect((await sharp(sent.body!).metadata()).format).toBe('jpeg')
  })
  it('serves a plated jpg, with no format asked for, as image/jpeg', async () => {
    const sent = await request({ content: await solid(100, '#336699', 'jpeg'), ext: '.jpg', query: { bg: 'fff' } })
    expect(sent.contentType).toBe('image/jpeg')
    expect((await sharp(sent.body!).metadata()).format).toBe('jpeg')
  })
})

describe('a plated raster is bounded (finding 2)', () => {
  it('draws a 3000 px logo no wider than 2048 px and shrinks the logo to fit', async () => {
    const sent = await request({
      content: await solid(3000, '#0000ff'),
      ext: '.png',
      query: { bg: 'ffffff', shape: 'square' },
    })
    const meta = await sharp(sent.body!).metadata()
    expect([meta.width, meta.height]).toEqual([2048, 2048])
    expect(sent.headers['x-resize']).toBe('2048x2048')
    // The logo is the blue block in the middle, inside a white margin of 8% on each side.
    const { data, info } = await sharp(sent.body!).raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels).slice(0, 3))
    expect(at(10, 10)).toEqual([255, 255, 255])
    expect(at(1024, 1024)).toEqual([0, 0, 255])
    expect(at(Math.round(2048 * 0.1), 1024)).toEqual([0, 0, 255])
  })
  it('still adds only the padding when the logo fits', async () => {
    const sent = await request({
      content: await solid(500, '#0000ff'),
      ext: '.png',
      query: { bg: 'ffffff', shape: 'square' },
    })
    expect((await sharp(sent.body!).metadata()).width).toBe(Math.ceil(500 / (1 - 2 * 0.08)))
  })
})

describe('a plated image is always mutable (finding 5)', () => {
  const content = async () => solid(64, '#050505')
  it.each<CachePolicy>(['content-addressed', 'mutable'])(
    'uses the configured lifetime when asked for %s',
    async (cachePolicy) => {
      const sent = await request({ content: await content(), ext: '.png', query: { bg: 'fff' }, cachePolicy })
      expect(sent.headers['cache-control']).toContain('max-age=86400')
      expect(sent.headers['cache-control']).toContain('stale-while-revalidate')
      expect(sent.headers['cache-control']).not.toContain('immutable')
      expect(sent.headers['cache-control']).not.toContain('31536000')
    },
  )
  it('keeps the immutable lifetime for a content-addressed resize that is not plated', async () => {
    const sent = await request({
      content: await content(),
      ext: '.png',
      query: { w: '32' },
      cachePolicy: 'content-addressed',
    })
    expect(sent.headers['cache-control']).toContain('immutable')
  })
  it('gives a plated vector the mutable lifetime too', async () => {
    const sent = await request({
      content: cronosSvg,
      ext: '.svg',
      query: { bg: 'fff' },
      cachePolicy: 'content-addressed',
    })
    expect(sent.contentType).toBe('image/svg+xml')
    expect(sent.headers['cache-control']).not.toContain('immutable')
  })
})

describe('plated renders spend a budget (finding 3)', () => {
  it('answers 429 with Retry-After once one image has used its plates, and not before', async () => {
    const plateLimiter = createRateLimiter({ perImageLimit: 2, globalLimit: 100 })
    const png = await solid(64, '#050505')
    const ask = (bg: string) =>
      request({ content: png, ext: '.png', imageHash: 'one-image', query: { bg }, plateLimiter })
    expect((await ask('111111')).handled).toBe(true)
    expect((await ask('222222')).body).not.toBeNull()
    const refused = await ask('333333')
    expect(refused.status).toBe(429)
    expect(refused.body).toBeNull()
    expect(refused.headers['retry-after']).toBe('60')
    expect(refused.headers['cache-control']).toBe('no-store')
    expect(refused.json).toEqual({ error: expect.stringMatching(/too many plated images/) })
    // Another image has its own allowance.
    expect(
      (await request({ content: png, ext: '.png', imageHash: 'another', query: { bg: '333333' }, plateLimiter })).body,
    ).not.toBeNull()
  })
  it('answers 429 when the global budget is spent, whatever the image', async () => {
    const plateLimiter = createRateLimiter({ perImageLimit: 10, globalLimit: 1 })
    const png = await solid(64, '#050505')
    await request({ content: png, ext: '.png', imageHash: 'a', query: { bg: '111111' }, plateLimiter })
    expect(
      (await request({ content: png, ext: '.png', imageHash: 'b', query: { bg: '111111' }, plateLimiter })).status,
    ).toBe(429)
  })
  it('does not spend the budget when contrast finds no plate is needed', async () => {
    const plateLimiter = createRateLimiter({ perImageLimit: 1, globalLimit: 100 })
    const bright = await solid(64, '#ffffff')
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const sent = await request({
        content: bright,
        ext: '.png',
        imageHash: 'bright',
        query: { contrast: 'dark' },
        plateLimiter,
      })
      expect(sent.handled).toBe(false)
      expect(sent.status).toBeNull()
    }
  })
  it('refuses a flood of different colours for one image instead of drawing each', async () => {
    const png = await solid(64, '#050505')
    let drawn = 0
    let refused = 0
    for (let colour = 0; colour < 40; colour += 1) {
      const sent = await request({
        content: png,
        ext: '.png',
        imageHash: 'flood',
        query: { bg: colour.toString(16).padStart(6, '0') },
      })
      if (sent.body) drawn += 1
      if (sent.status === 429) refused += 1
    }
    expect(drawn).toBe(30)
    expect(refused).toBe(10)
  })
})

describe('plated renders are limited to a few at once (finding 3)', () => {
  it('runs one at a time through a gate of one and queues the rest', async () => {
    const plateGate = createConcurrencyGate({ limit: 1, maxQueue: 8 })
    const png = await solid(64, '#050505')
    const pending = [1, 2, 3].map((index) =>
      request({
        content: png,
        ext: '.png',
        query: { bg: `00000${index}` },
        plateGate,
        plateLimiter: createRateLimiter(),
      }),
    )
    expect(plateGate.active).toBe(1)
    expect(plateGate.waiting).toBe(2)
    const sent = await Promise.all(pending)
    expect(sent.every((one) => one.body !== null)).toBe(true)
    expect(plateGate.active).toBe(0)
    expect(plateGate.waiting).toBe(0)
  })
  it('answers 503 with Retry-After when every slot is busy and the line is full', async () => {
    const plateGate = createConcurrencyGate({ limit: 1, maxQueue: 0 })
    let release = () => {}
    const holding = plateGate.run(() => new Promise<void>((resolve) => (release = resolve)))
    const sent = await request({ content: await solid(64, '#050505'), ext: '.png', query: { bg: 'fff' }, plateGate })
    expect(sent.status).toBe(503)
    expect(sent.body).toBeNull()
    expect(sent.headers['retry-after']).toBe('2')
    expect(sent.headers['cache-control']).toBe('no-store')
    expect(sent.json).toEqual({ error: expect.stringMatching(/try again shortly/) })
    release()
    await holding
  })
  it('does not gate a request that asks for no plate', async () => {
    const plateGate = createConcurrencyGate({ limit: 1, maxQueue: 0 })
    let release = () => {}
    const holding = plateGate.run(() => new Promise<void>((resolve) => (release = resolve)))
    const sent = await request({ content: await solid(64, '#050505'), ext: '.png', query: { w: '32' }, plateGate })
    expect(sent.status).toBeNull()
    expect(sent.body).not.toBeNull()
    release()
    await holding
  })
})

describe('a source that cannot be decoded is answered as the plain request would be (finding 7)', () => {
  it('serves the original for contrast=, not a 500, and decodes it once for a minute', async () => {
    const options = { content: garbage, ext: '.png', imageHash: 'broken-contrast', query: { contrast: 'dark' } }
    const first = await request(options)
    const second = await request(options)
    expect(first.handled).toBe(false)
    expect(second.handled).toBe(false)
    expect(first.status).toBeNull()
    expect(failureLog).toHaveBeenCalledTimes(1)
    expect(vi.mocked(failureLog).mock.calls[0][1]).toBe('measure')
  })
  it('serves the original for bg= on an undrawable source, logging the failure once', async () => {
    const options = { content: garbage, ext: '.png', imageHash: 'broken-bg', query: { bg: 'fff' } }
    expect((await request(options)).handled).toBe(false)
    expect((await request(options)).handled).toBe(false)
    expect(failureLog).toHaveBeenCalledTimes(1)
    expect(vi.mocked(failureLog).mock.calls[0][0]).toContain('plate: could not %s')
    expect(vi.mocked(failureLog).mock.calls[0][1]).toBe('draw')
  })
  it('does not spend the budget on a source it cannot draw', async () => {
    const plateLimiter = createRateLimiter({ perImageLimit: 1, globalLimit: 100 })
    const options = { content: garbage, ext: '.png', imageHash: 'broken-budget', query: { bg: 'fff' }, plateLimiter }
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await request(options)).status).toBeNull()
  })
  it('lets a plain failure be the plain request’s failure when a size was asked for too', async () => {
    await expect(request({ content: garbage, ext: '.png', query: { contrast: 'dark', w: '32' } })).rejects.toThrow()
  })
})

describe('measuring a vector is bounded (finding 8)', () => {
  const hugeSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="6000" viewBox="0 0 24 24"><rect width="24" height="24" fill="#000"/></svg>',
  )
  it('opens a vector at about the sample size, however large it declares itself', async () => {
    const opened = await openForMeasurement({ content: hugeSvg, ext: '.svg' })
    const { width, height } = await opened.metadata()
    expect(width).toBeLessThanOrEqual(128)
    expect(height).toBeLessThanOrEqual(128)
    // The plain opener would have drawn the full 6000 px.
    expect(
      (await (await openSource({ content: hugeSvg, ext: '.svg', target: { w: 64, h: 64 } })).metadata()).width,
    ).toBe(6000)
  })
  it('does not draw a small vector larger than its own size', async () => {
    const opened = await openForMeasurement({ content: cronosSvg, ext: '.svg' })
    expect((await opened.metadata()).width).toBeLessThanOrEqual(128)
  })
  it('opens a raster as it is', async () => {
    const opened = await openForMeasurement({ content: await solid(300, '#000000'), ext: '.png' })
    expect((await opened.metadata()).width).toBe(300)
  })
  it('still measures a huge vector correctly', async () => {
    const sent = await request({ content: hugeSvg, ext: '.svg', query: { contrast: 'dark' } })
    expect(sent.contentType).toBe('image/svg+xml')
  })
})

describe('the source size is read once (finding 10)', () => {
  it('trusts an intrinsic size the caller already has', async () => {
    const opened = await openSource({
      content: cronosSvg,
      ext: '.svg',
      target: { w: 200, h: 200 },
      intrinsic: { width: 100, height: 100 },
    })
    // Scale 2 from the stated 100 px: density 144. Read from the file (24 px) it would be about 600.
    expect((await opened.metadata()).density).toBe(144)
  })
})

describe('what a fetched source is remembered under (finding 9)', () => {
  const linkImage = { content: Buffer.alloc(0), mode: 'link', uri: 'https://example.com/logo.svg' }
  const serve = (body: Buffer) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(body))),
    )

  it('measures again when the same address answers with different bytes', async () => {
    const options = {
      content: Buffer.alloc(0),
      ext: '.svg',
      imageHash: 'linked',
      query: { contrast: 'dark' },
      extra: linkImage,
    }
    serve(cronosSvg)
    const dark = await request(options)
    serve(ethereumSvg)
    const bright = await request(options)
    // A cache keyed by the row would have called the second logo as dark as the first.
    expect(dark.handled).toBe(true)
    expect(bright.handled).toBe(false)
  })
  it('keeps the answer for the same bytes, so a fetched logo is measured once', async () => {
    const options = {
      content: Buffer.alloc(0),
      ext: '.svg',
      imageHash: 'linked-same',
      query: { contrast: 'dark' },
      extra: linkImage,
    }
    serve(cronosSvg)
    expect((await request(options)).handled).toBe(true)
    expect((await request({ ...options, imageHash: 'a-different-row' })).handled).toBe(true)
  })
})
