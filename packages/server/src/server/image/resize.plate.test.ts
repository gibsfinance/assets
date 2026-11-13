import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'

// Only the database and configuration are replaced. sharp is real: the assertions decode what
// was sent and read its pixels, because the claim is about what a caller sees.
vi.mock('../../db/tables', () => ({ imageMode: { LINK: 'link' } }))
vi.mock('../../db', () => ({
  getVariant: vi.fn().mockResolvedValue(undefined),
  bumpVariantAccess: vi.fn().mockResolvedValue(undefined),
  insertVariant: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../../config', () => ({ default: { cacheSeconds: 86400 } }))

import * as db from '../../db'
import { maybeResize, parseResizeParams, resetRateLimit } from './resize'

const cronosSvg = readFileSync(new URL('./__fixtures__/cronos-web3icons.svg', import.meta.url))
const ethereumSvg = readFileSync(new URL('./__fixtures__/ethereum-smoldapp.svg', import.meta.url))
const twoToneSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="12" height="24" fill="#000"/><rect x="12" width="12" height="24" fill="#fff"/></svg>',
)
const paleSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#f0f0f0"/></svg>',
)
const noViewBoxSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#0a0"/></svg>',
)
const darkPng = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#050505' } })
  .png()
  .toBuffer()

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimit()
})

interface Sent {
  handled: boolean
  body: Buffer | null
  contentType: string | null
  headers: Record<string, string>
}

/** Run `maybeResize` for one query and capture what the response carried. */
async function request(options: {
  content: Buffer
  ext: string
  query: Record<string, string>
  imageHash?: string
  extra?: Record<string, unknown>
}): Promise<Sent> {
  const headers: Record<string, string> = {}
  const sent: Sent = { handled: false, body: null, contentType: null, headers }
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
  const img: any = {
    imageHash: options.imageHash ?? `hash-${Math.random()}`,
    content: options.content,
    ext: options.ext,
    uri: 'https://example.com/logo',
    mode: 'save',
    ...options.extra,
  }
  sent.handled = await maybeResize({ res, img, params: parseResizeParams({ query: options.query }) })
  return sent
}

async function pixel(body: Buffer, x: number, y: number) {
  const { data, info } = await sharp(body).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const start = (y * info.width + x) * 4
  return Array.from(data.subarray(start, start + 4))
}

describe('parseResizeParams with a plate', () => {
  it('is null as before when nothing is asked for', () => {
    expect(parseResizeParams({ query: { shape: 'circle' } })).toBeNull()
  })
  it('carries the plate request, and the old fields keep their shape without one', () => {
    expect(parseResizeParams({ query: { bg: 'fff' } })?.plate).toMatchObject({ shape: 'circle' })
    expect(parseResizeParams({ query: { w: '5' } })).toEqual({ w: 5, h: null, format: null, unconvertibleFormat: null })
  })
  it('answers 400 for a bad colour even when nothing else is asked for', () => {
    expect(() => parseResizeParams({ query: { bg: 'nope' } })).toThrow(/bg must be/)
  })
})

describe('a plated vector image', () => {
  it('stays svg, with a white plate behind the Cronos logo, for contrast=dark', async () => {
    const sent = await request({ content: cronosSvg, ext: '.svg', query: { contrast: 'dark' } })
    expect(sent.handled).toBe(true)
    expect(sent.contentType).toBe('image/svg+xml')
    const body = sent.body!.toString('utf8')
    expect(body).toMatch(/^<svg [^>]*viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#ffffff"\/>/)
    expect(body).toContain('viewBox="0 0 24 24"')
    expect(body).toContain('d="M12.003 3 4.125')
    expect(sent.headers['x-resize']).toBe('transcoded')
    expect(sent.headers['cache-control']).toContain('max-age=86400')
  })
  it('leaves the real Cronos logo plain on a light page', async () => {
    expect((await request({ content: cronosSvg, ext: '.svg', query: { contrast: 'light' } })).handled).toBe(false)
  })
  it('leaves the real Ethereum logo plain on a dark page', async () => {
    const sent = await request({ content: ethereumSvg, ext: '.svg', query: { contrast: 'dark' } })
    expect(sent.handled).toBe(false)
    expect(sent.body).toBeNull()
  })
  it('leaves the real Ethereum logo plain on a light page, where its white glyph vanishes but its disc does not', async () => {
    const sent = await request({ content: ethereumSvg, ext: '.svg', query: { contrast: 'light' } })
    expect(sent.handled).toBe(false)
  })
  it('leaves a half black, half white logo plain on either page', async () => {
    for (const contrast of ['dark', 'light']) {
      expect((await request({ content: twoToneSvg, ext: '.svg', query: { contrast } })).handled).toBe(false)
    }
  })
  it('plates a pale logo on a light page, with a dark plate', async () => {
    const sent = await request({ content: paleSvg, ext: '.svg', query: { contrast: 'light' } })
    expect(sent.body!.toString('utf8')).toContain('fill="#111827"')
  })
  it('paints bg in the chosen shape whatever the logo, and ignores w and h for a vector', async () => {
    const sent = await request({
      content: ethereumSvg,
      ext: '.svg',
      query: { bg: 'ff0000', shape: 'rounded', w: '50' },
    })
    expect(sent.contentType).toBe('image/svg+xml')
    expect(sent.body!.toString('utf8')).toContain('<rect width="100" height="100" rx="22" ry="22" fill="#ff0000"/>')
  })
  it('wraps an svg asked for as svg', async () => {
    const sent = await request({ content: cronosSvg, ext: '.svg', query: { as: 'svg', bg: '000' } })
    expect(sent.contentType).toBe('image/svg+xml')
  })
  it('serves an svg asked for as svg unchanged when contrast needs no plate', async () => {
    const sent = await request({ content: ethereumSvg, ext: '.svg', query: { as: 'svg', contrast: 'dark' } })
    expect(sent.handled).toBe(false)
  })
  it('puts bg in charge of the colour and contrast in charge of whether', async () => {
    const needed = await request({ content: cronosSvg, ext: '.svg', query: { bg: '00ff00', contrast: 'dark' } })
    expect(needed.body!.toString('utf8')).toContain('fill="#00ff00"')
    const notNeeded = await request({
      content: ethereumSvg,
      ext: '.svg',
      query: { bg: '00ff00', contrast: 'dark' },
    })
    expect(notNeeded.handled).toBe(false)
  })
  it('measures a logo once and remembers it', async () => {
    const options = { content: cronosSvg, ext: '.svg', query: { contrast: 'dark' }, imageHash: 'remembered-hash' }
    const first = await request(options)
    // Measured afresh, this bright logo would need no plate. It gets one because the hash was
    // already measured, from the dark logo, and that answer is remembered.
    const second = await request({ ...options, content: ethereumSvg })
    expect(first.handled).toBe(true)
    expect(second.handled).toBe(true)
    expect((await request({ content: ethereumSvg, ext: '.svg', query: options.query })).handled).toBe(false)
  })
  it('never reads or writes the variant cache, so a plate cannot reach a plain request', async () => {
    await request({ content: cronosSvg, ext: '.svg', query: { contrast: 'dark' } })
    await request({ content: darkPng, ext: '.png', query: { bg: 'fff', w: '32' } })
    expect(db.getVariant).not.toHaveBeenCalled()
    expect(db.insertVariant).not.toHaveBeenCalled()
  })
  it('gives different bytes, and so a different ETag, for different plates', async () => {
    const light = await request({ content: cronosSvg, ext: '.svg', query: { bg: 'ffffff' } })
    const red = await request({ content: cronosSvg, ext: '.svg', query: { bg: 'ff0000' } })
    expect(light.body!.equals(red.body!)).toBe(false)
  })
})

describe('a plated image drawn to pixels', () => {
  it('draws a vector as png when a format is asked for: plate at the corner, logo in the centre', async () => {
    const sent = await request({
      content: ethereumSvg,
      ext: '.svg',
      query: { bg: 'ffffff', shape: 'square', as: 'png', w: '128' },
    })
    expect(sent.contentType).toBe('image/png')
    expect(sent.headers['x-resize']).toBe('128x128')
    const meta = await sharp(sent.body!).metadata()
    expect([meta.width, meta.height]).toEqual([128, 128])
    expect(await pixel(sent.body!, 1, 1)).toEqual([255, 255, 255, 255])
    expect((await pixel(sent.body!, 64, 64)).slice(0, 3)).not.toEqual([255, 255, 255])
  })
  it('draws a circle plate with empty corners', async () => {
    const sent = await request({ content: ethereumSvg, ext: '.svg', query: { bg: 'ffffff', as: 'webp', w: '64' } })
    expect(sent.contentType).toBe('image/webp')
    expect((await pixel(sent.body!, 0, 0))[3]).toBe(0)
  })
  it('uses the default vector size when none is asked for', async () => {
    const sent = await request({ content: ethereumSvg, ext: '.svg', query: { bg: 'ffffff', as: 'png' } })
    expect((await sharp(sent.body!).metadata()).width).toBe(256)
  })
  it('keeps a raster source png and its own size plus padding', async () => {
    const sent = await request({ content: darkPng, ext: '.png', query: { contrast: 'dark', shape: 'square' } })
    expect(sent.contentType).toBe('image/png')
    const meta = await sharp(sent.body!).metadata()
    expect(meta.width).toBe(Math.ceil(64 / (1 - 2 * 0.08)))
    expect(await pixel(sent.body!, 1, 1)).toEqual([255, 255, 255, 255])
    expect((await pixel(sent.body!, Math.floor(meta.width! / 2), Math.floor(meta.width! / 2))).slice(0, 3)).toEqual([
      5, 5, 5,
    ])
  })
  it('leaves a bright raster alone on a dark page', async () => {
    const bright = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } })
      .png()
      .toBuffer()
    expect((await request({ content: bright, ext: '.png', query: { contrast: 'dark' } })).handled).toBe(false)
  })
  it('draws an svg with no viewBox as png rather than wrapping it', async () => {
    const sent = await request({ content: noViewBoxSvg, ext: '.svg', query: { bg: 'ffffff' } })
    expect(sent.contentType).toBe('image/png')
  })
  it('flattens a jpg onto white at its corners', async () => {
    const sent = await request({ content: darkPng, ext: '.png', query: { bg: '000000', as: 'jpg', w: '80' } })
    expect(sent.contentType).toBe('image/jpeg')
    expect((await pixel(sent.body!, 0, 0)).slice(0, 3).every((channel) => channel > 240)).toBe(true)
  })
  it('refuses to turn a raster into svg even with a plate', async () => {
    await expect(request({ content: darkPng, ext: '.png', query: { as: 'svg', bg: 'fff' } })).rejects.toThrow(
      /not available for this image/,
    )
  })
  it('still redirects a link-only source rather than copying it onto a plate', async () => {
    const sent = await request({
      content: Buffer.alloc(0),
      ext: '.png',
      query: { bg: 'fff' },
      extra: { mode: 'link', uri: 'https://static.debank.com/image/logo.png' },
    })
    expect(sent.handled).toBe(false)
  })
})
