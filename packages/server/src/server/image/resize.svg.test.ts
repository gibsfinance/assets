import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'

// Only the database and configuration are replaced. sharp is real on purpose:
// the bug was in how sharp sized the picture, so the assertions decode the
// bytes that were sent and read their true dimensions.
vi.mock('../../db/tables', () => ({ imageMode: { LINK: 'link' } }))
vi.mock('../../db', () => ({
  getVariant: vi.fn().mockResolvedValue(undefined),
  bumpVariantAccess: vi.fn().mockResolvedValue(undefined),
  insertVariant: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../../config', () => ({ default: { cacheSeconds: 86400 } }))

import { maybeResize, parseResizeParams, computeSvgScale, densityForScale, openSource, resetRateLimit } from './resize'

const squareSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#09f"/></svg>',
)
const wideSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20" fill="#f90"/></svg>',
)
const viewBoxOnlySvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#0a0"/></svg>',
)
const rasterPng = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#f00' } })
  .png()
  .toBuffer()

beforeEach(() => {
  resetRateLimit()
})

/** Run `maybeResize` against real sharp and return the decoded dimensions of what was sent. */
async function requestedDimensions(options: {
  content: Buffer
  ext: string
  query: Record<string, string>
}): Promise<{ width?: number; height?: number }> {
  const res: any = {}
  res.set = vi.fn().mockReturnValue(res)
  res.contentType = vi.fn().mockReturnValue(res)
  res.send = vi.fn().mockReturnValue(res)
  const img: any = {
    imageHash: 'svg-hash',
    content: options.content,
    ext: options.ext,
    uri: 'https://example.com/logo',
    mode: 'save',
  }
  const handled = await maybeResize({ res, img, params: parseResizeParams({ query: options.query }) })
  expect(handled).toBe(true)
  const sent = res.send.mock.calls[0][0] as Buffer
  const { width, height } = await sharp(sent).metadata()
  return { width, height }
}

describe('computeSvgScale', () => {
  it('is 1 when the intrinsic size is unknown', () => {
    expect(computeSvgScale({ intrinsic: {}, target: { w: 128, h: 128 } })).toBe(1)
    expect(computeSvgScale({ intrinsic: { width: 32 }, target: { w: 128, h: null } })).toBe(1)
  })

  it('is 1 when no size is requested', () => {
    expect(computeSvgScale({ intrinsic: { width: 32, height: 32 }, target: { w: null, h: null } })).toBe(1)
  })

  it('scales to a requested width, or to a requested height', () => {
    const intrinsic = { width: 32, height: 32 }
    expect(computeSvgScale({ intrinsic, target: { w: 128, h: null } })).toBe(4)
    expect(computeSvgScale({ intrinsic, target: { w: null, h: 64 } })).toBe(2)
  })

  it('takes the smaller ratio so the image fits inside both sides', () => {
    expect(computeSvgScale({ intrinsic: { width: 40, height: 20 }, target: { w: 80, h: 80 } })).toBe(2)
  })

  it('never goes below 1 for a smaller request', () => {
    expect(computeSvgScale({ intrinsic: { width: 64, height: 64 }, target: { w: 16, h: 16 } })).toBe(1)
  })

  it('caps the drawn long side for an extreme aspect ratio', () => {
    const scale = computeSvgScale({ intrinsic: { width: 1, height: 1000 }, target: { w: 2048, h: null } })
    expect(scale).toBeCloseTo(2.048)
  })
})

describe('densityForScale', () => {
  it('multiplies the base density and rounds up', () => {
    expect(densityForScale(4)).toBe(288)
    expect(densityForScale(1.01)).toBe(73)
  })

  it('stops at the highest density sharp accepts', () => {
    expect(densityForScale(1e9)).toBe(100000)
  })
})

describe('openSource', () => {
  it('opens a raster source unchanged', async () => {
    const { width } = await (
      await openSource({ content: rasterPng, ext: '.png', target: { w: 128, h: 128 } })
    ).metadata()
    expect(width).toBe(32)
  })

  it('opens a vector source unchanged when no size is requested', async () => {
    const { width } = await (
      await openSource({ content: squareSvg, ext: '.svg', target: { w: null, h: null } })
    ).metadata()
    expect(width).toBe(32)
  })

  it('opens a vector source unchanged when the request is not larger', async () => {
    const { width } = await (await openSource({ content: squareSvg, ext: '.svg', target: { w: 16, h: 16 } })).metadata()
    expect(width).toBe(32)
  })

  it('draws a vector source at the requested size', async () => {
    const { width } = await (
      await openSource({ content: squareSvg, ext: '.svg+xml', target: { w: 128, h: 128 } })
    ).metadata()
    expect(width).toBe(128)
  })
})

describe('maybeResize with a small vector source, real sharp', () => {
  it('serves 128 by 128 when 128 by 128 is requested', async () => {
    const size = await requestedDimensions({
      content: squareSvg,
      ext: '.svg',
      query: { w: '128', h: '128', as: 'webp' },
    })
    expect(size).toEqual({ width: 128, height: 128 })
  })

  it('serves 128 by 128 when only the width is requested', async () => {
    const size = await requestedDimensions({ content: squareSvg, ext: '.svg', query: { w: '128', as: 'webp' } })
    expect(size).toEqual({ width: 128, height: 128 })
  })

  it('serves 128 by 128 when only the height is requested', async () => {
    const size = await requestedDimensions({ content: squareSvg, ext: '.svg', query: { h: '128', as: 'webp' } })
    expect(size).toEqual({ width: 128, height: 128 })
  })

  it('keeps the aspect ratio of a wide image, fitted inside the box', async () => {
    const size = await requestedDimensions({
      content: wideSvg,
      ext: '.svg',
      query: { w: '128', h: '128', as: 'webp' },
    })
    expect(size).toEqual({ width: 128, height: 64 })
  })

  it('serves a drawing that has a viewBox and no width or height at the requested size', async () => {
    const size = await requestedDimensions({
      content: viewBoxOnlySvg,
      ext: '.svg',
      query: { w: '96', h: '96', as: 'webp' },
    })
    expect(size).toEqual({ width: 96, height: 96 })
  })

  it('treats the .svg+xml extension the same way', async () => {
    const size = await requestedDimensions({
      content: squareSvg,
      ext: '.svg+xml',
      query: { w: '128', h: '128', as: 'png' },
    })
    expect(size).toEqual({ width: 128, height: 128 })
  })

  it('still shrinks a vector source to a smaller request', async () => {
    const size = await requestedDimensions({
      content: squareSvg,
      ext: '.svg',
      query: { w: '16', h: '16', as: 'webp' },
    })
    expect(size).toEqual({ width: 16, height: 16 })
  })

  it('keeps the intrinsic size when only a format is requested', async () => {
    const size = await requestedDimensions({ content: squareSvg, ext: '.svg', query: { as: 'png' } })
    expect(size).toEqual({ width: 32, height: 32 })
  })

  it('never draws a very narrow image past the longest side allowed', async () => {
    const narrow = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="400" viewBox="0 0 2 400"><rect width="2" height="400"/></svg>',
    )
    const size = await requestedDimensions({ content: narrow, ext: '.svg', query: { w: '2048', as: 'webp' } })
    // Density is rounded up to a whole number, so the cap can be passed by a few pixels, not by thousands.
    expect(size.height).toBeLessThanOrEqual(2048 + 16)
  })
})

describe('maybeResize with a raster source, real sharp', () => {
  it('does not enlarge a raster image', async () => {
    const size = await requestedDimensions({
      content: rasterPng,
      ext: '.png',
      query: { w: '128', h: '128', as: 'webp' },
    })
    expect(size).toEqual({ width: 32, height: 32 })
  })

  it('shrinks a raster image', async () => {
    const size = await requestedDimensions({
      content: rasterPng,
      ext: '.png',
      query: { w: '16', h: '16', as: 'webp' },
    })
    expect(size).toEqual({ width: 16, height: 16 })
  })
})
