import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import {
  PAGE_LUMINANCE,
  PLATE_CONTRAST_THRESHOLD,
  PLATE_DEFAULT_VECTOR_SIDE,
  CONTRAST_PLATE_COLOUR,
  computePlateSide,
  contrastRatio,
  createLuminanceCache,
  logoNeedsPlate,
  measureVisibleLuminance,
  parseHexColour,
  parsePlateRequest,
  plateInnerSide,
  plateShapeMarkup,
  relativeLuminance,
  renderPlatedRaster,
  resolvePlate,
  visibleLuminance,
  wrapSvgWithPlate,
  type Plate,
} from './plate'

/** The file https://staging.gib.show/image/25 served (Cronos, web3icons, MIT): a dark navy hexagon. */
const cronosSvg = readFileSync(new URL('./__fixtures__/cronos-web3icons.svg', import.meta.url))
/** Reproduces the Ethereum logo's case: a mid-blue disc with a white glyph, as `/image/1` serves it. */
const ethereumLikeSvg = Buffer.from(
  '<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="16" fill="#627EEA"/><path d="M9 16.2 16.5 4v8.9zM16.5 22V28L9 17.6z" fill="white"/></svg>',
)
const white: Plate = { colour: { red: 255, green: 255, blue: 255, alpha: 1 }, shape: 'circle' }

/** Rasterize a document drawn at `side` pixels and return its raw RGBA pixels. */
async function pixelsOf(buffer: Buffer, density?: number) {
  const { data, info } = await sharp(buffer, density ? { density } : undefined)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const at = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4))
  return { at, width: info.width, height: info.height }
}

describe('parseHexColour', () => {
  it('reads six digits', () => {
    expect(parseHexColour('1a2b3c')).toEqual({ red: 0x1a, green: 0x2b, blue: 0x3c, alpha: 1 })
  })
  it('repeats each digit of a three digit colour', () => {
    expect(parseHexColour('f80')).toEqual({ red: 255, green: 0x88, blue: 0, alpha: 1 })
  })
  it('reads alpha from eight digits', () => {
    expect(parseHexColour('ff000080')?.alpha).toBeCloseTo(128 / 255)
  })
  it.each(['', 'ff', 'ffff', 'fffff', 'fffffff', 'zzzzzz', '#ffffff', 'fffffffff'])('refuses %j', (value) => {
    expect(parseHexColour(value)).toBeNull()
  })
})

describe('parsePlateRequest', () => {
  it('is null when neither bg nor contrast is given', () => {
    expect(parsePlateRequest({})).toBeNull()
    expect(parsePlateRequest({ w: '10' })).toBeNull()
  })
  it('ignores a valid shape that stands alone', () => {
    expect(parsePlateRequest({ shape: 'square' })).toBeNull()
  })
  it('refuses a shape that is not one of the three, even alone', () => {
    expect(() => parsePlateRequest({ shape: 'star' })).toThrow(/shape must be one of: circle, rounded, square/)
  })
  it('defaults the shape to circle', () => {
    expect(parsePlateRequest({ bg: 'fff' })).toMatchObject({ shape: 'circle', contrast: null })
  })
  it('keeps colour, shape and contrast together, in any case', () => {
    const request = parsePlateRequest({ bg: 'FF0000', shape: 'Rounded', contrast: 'LIGHT' })
    expect(request).toEqual({ colour: { red: 255, green: 0, blue: 0, alpha: 1 }, shape: 'rounded', contrast: 'light' })
  })
  it('leaves the colour open when only contrast is given', () => {
    expect(parsePlateRequest({ contrast: 'dark' })).toEqual({ colour: null, shape: 'circle', contrast: 'dark' })
  })
  it.each([{ bg: '' }, { bg: 'xyz' }, { bg: '#fff' }, { bg: ['fff', '000'] }, { bg: { a: 'b' } }])(
    'answers 400 for the bad colour %j',
    (query) => {
      expect(() => parsePlateRequest(query)).toThrow(/bg must be 3, 6 or 8 hex digits/)
      try {
        parsePlateRequest(query)
      } catch (error) {
        expect((error as { status: number }).status).toBe(400)
      }
    },
  )
  it.each(['sideways', '', 'dark,light'])('answers 400 for contrast=%j', (contrast) => {
    expect(() => parsePlateRequest({ contrast })).toThrow(/contrast must be one of: dark, light/)
  })
  it('refuses a repeated parameter', () => {
    expect(() => parsePlateRequest({ contrast: ['dark', 'light'] })).toThrow(/contrast must be/)
  })
})

describe('luminance arithmetic', () => {
  it('gives 0 for black and 1 for white', () => {
    expect(relativeLuminance({ red: 0, green: 0, blue: 0 })).toBe(0)
    expect(relativeLuminance({ red: 255, green: 255, blue: 255 })).toBeCloseTo(1)
  })
  it('weights green most', () => {
    const green = relativeLuminance({ red: 0, green: 255, blue: 0 })
    expect(green).toBeGreaterThan(relativeLuminance({ red: 255, green: 0, blue: 0 }))
    expect(green).toBeGreaterThan(relativeLuminance({ red: 0, green: 0, blue: 255 }))
  })
  it('uses the linear branch for very dark channels', () => {
    expect(relativeLuminance({ red: 10, green: 10, blue: 10 })).toBeCloseTo(10 / 255 / 12.92, 6)
  })
  it('puts black on white at 21:1, whichever argument comes first', () => {
    expect(contrastRatio(0, 1)).toBeCloseTo(21)
    expect(contrastRatio(1, 0)).toBeCloseTo(21)
    expect(contrastRatio(0.5, 0.5)).toBe(1)
  })
})

describe('visibleLuminance', () => {
  it('counts each pixel in proportion to its alpha', () => {
    // A white opaque pixel and a black transparent one: the black one adds nothing.
    expect(visibleLuminance(Uint8Array.of(255, 255, 255, 255, 0, 0, 0, 0))).toBeCloseTo(1)
    // The same black pixel opaque halves it.
    expect(visibleLuminance(Uint8Array.of(255, 255, 255, 255, 0, 0, 0, 255))).toBeCloseTo(0.5)
  })
  it('is null when nothing is visible', () => {
    expect(visibleLuminance(Uint8Array.of(255, 255, 255, 0))).toBeNull()
    expect(visibleLuminance(new Uint8Array())).toBeNull()
  })
})

describe('measureVisibleLuminance on real logos', () => {
  it('finds the Cronos logo nearly black', async () => {
    const luminance = await measureVisibleLuminance(sharp(cronosSvg, { density: 192 }))
    expect(luminance).toBeGreaterThan(0.004)
    expect(luminance).toBeLessThan(0.008)
  })
  it('finds an Ethereum-like logo bright enough for a dark page', async () => {
    const luminance = await measureVisibleLuminance(sharp(ethereumLikeSvg, { density: 144 }))
    expect(contrastRatio(luminance!, PAGE_LUMINANCE.dark)).toBeGreaterThan(PLATE_CONTRAST_THRESHOLD)
  })
  it('measures a greyscale picture with no alpha channel', async () => {
    const grey = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } })
      .greyscale()
      .png()
      .toBuffer()
    expect(await measureVisibleLuminance(sharp(grey))).toBeCloseTo(1, 1)
  })
  it('is null for a fully transparent picture', async () => {
    const clear = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer()
    expect(await measureVisibleLuminance(sharp(clear))).toBeNull()
  })
})

describe('resolvePlate', () => {
  const cronos = 0.0057
  const ethereum = 0.329
  const never = vi.fn().mockRejectedValue(new Error('must not measure'))
  const luminanceOf = (value: number | null) => vi.fn().mockResolvedValue(value)
  const request = (overrides: Partial<Parameters<typeof resolvePlate>[0]['request']>) => ({
    colour: null,
    shape: 'circle' as const,
    contrast: null,
    ...overrides,
  })

  it('threshold: Cronos needs a plate on a dark page and Ethereum does not', () => {
    expect(logoNeedsPlate({ luminance: cronos, contrast: 'dark' })).toBe(true)
    expect(logoNeedsPlate({ luminance: ethereum, contrast: 'dark' })).toBe(false)
  })
  it('adds a light plate to a dark logo on a dark page', async () => {
    const plate = await resolvePlate({ request: request({ contrast: 'dark' }), measureLuminance: luminanceOf(cronos) })
    expect(plate).toEqual({ colour: CONTRAST_PLATE_COLOUR.dark, shape: 'circle' })
    expect(plate!.colour).toMatchObject({ red: 255, green: 255, blue: 255 })
  })
  it('adds a dark plate to a bright logo on a light page', async () => {
    const plate = await resolvePlate({ request: request({ contrast: 'light' }), measureLuminance: luminanceOf(0.9) })
    expect(plate!.colour.red).toBeLessThan(50)
  })
  it('adds nothing when the logo already stands out', async () => {
    expect(
      await resolvePlate({ request: request({ contrast: 'dark' }), measureLuminance: luminanceOf(ethereum) }),
    ).toBeNull()
  })
  it('adds nothing when nothing is visible', async () => {
    expect(
      await resolvePlate({ request: request({ contrast: 'dark' }), measureLuminance: luminanceOf(null) }),
    ).toBeNull()
  })
  it('paints bg without measuring anything', async () => {
    const colour = { red: 1, green: 2, blue: 3, alpha: 1 }
    const plate = await resolvePlate({ request: request({ colour, shape: 'square' }), measureLuminance: never })
    expect(plate).toEqual({ colour, shape: 'square' })
    expect(never).not.toHaveBeenCalled()
  })
  it('uses bg as the colour when contrast says a plate is needed', async () => {
    const colour = { red: 200, green: 0, blue: 0, alpha: 1 }
    const plate = await resolvePlate({
      request: request({ colour, contrast: 'dark' }),
      measureLuminance: luminanceOf(cronos),
    })
    expect(plate!.colour).toBe(colour)
  })
  it('lets contrast withhold the bg plate', async () => {
    const colour = { red: 200, green: 0, blue: 0, alpha: 1 }
    expect(
      await resolvePlate({ request: request({ colour, contrast: 'dark' }), measureLuminance: luminanceOf(ethereum) }),
    ).toBeNull()
  })
  it('draws nothing for a request that names neither colour nor contrast', async () => {
    expect(await resolvePlate({ request: request({}), measureLuminance: never })).toBeNull()
  })
})

describe('createLuminanceCache', () => {
  it('measures a key once, including a null answer', async () => {
    const cache = createLuminanceCache()
    const measure = vi.fn().mockResolvedValue(null)
    expect(await cache.remember('a', measure)).toBeNull()
    expect(await cache.remember('a', measure)).toBeNull()
    expect(measure).toHaveBeenCalledTimes(1)
    expect(cache.size).toBe(1)
  })
  it('drops the oldest entry when full', async () => {
    const cache = createLuminanceCache({ limit: 2 })
    for (const key of ['a', 'b', 'c']) await cache.remember(key, async () => 0.5)
    expect(cache.size).toBe(2)
    const again = vi.fn().mockResolvedValue(0.1)
    await cache.remember('a', again)
    expect(again).toHaveBeenCalledTimes(1)
    const kept = vi.fn().mockResolvedValue(0.1)
    await cache.remember('c', kept)
    expect(kept).not.toHaveBeenCalled()
  })
  it('works with the default limit', () => {
    expect(createLuminanceCache().size).toBe(0)
  })
})

describe('plateShapeMarkup', () => {
  const colour = { red: 255, green: 136, blue: 0, alpha: 1 }
  it('draws a circle', () => {
    expect(plateShapeMarkup({ colour, shape: 'circle' })).toBe('<circle cx="50" cy="50" r="50" fill="#ff8800"/>')
  })
  it('draws a rounded square', () => {
    expect(plateShapeMarkup({ colour, shape: 'rounded' })).toBe(
      '<rect width="100" height="100" rx="22" ry="22" fill="#ff8800"/>',
    )
  })
  it('draws a square', () => {
    expect(plateShapeMarkup({ colour, shape: 'square' })).toBe('<rect width="100" height="100" fill="#ff8800"/>')
  })
  it('states alpha as a fill opacity', () => {
    expect(plateShapeMarkup({ colour: { ...colour, alpha: 0.5 }, shape: 'square' })).toContain('fill-opacity="0.5"')
  })
})

describe('wrapSvgWithPlate', () => {
  /** The wrapped document as parsed markup, found by regular expressions over its few known tags. */
  const wrap = (content: Buffer | string, plate: Plate = white) =>
    wrapSvgWithPlate({ content: Buffer.from(content), plate })?.toString('utf8') ?? null

  it('draws the plate first and the original nested after it, with its viewBox kept', () => {
    const wrapped = wrap(cronosSvg)!
    expect(wrapped.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle')).toBe(true)
    expect(wrapped.indexOf('<circle')).toBeLessThan(wrapped.indexOf('<svg x='))
    expect(wrapped).toContain(
      '<svg x="15" y="15" width="70" height="70" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="web3icons">',
    )
    expect(wrapped).toContain('d="M12.003 3 4.125')
    expect(wrapped.endsWith('</svg></svg>')).toBe(true)
  })
  it('is valid enough for a renderer: the corner is plate coloured and the centre is not', async () => {
    const wrapped = wrapSvgWithPlate({ content: cronosSvg, plate: { ...white, shape: 'square' } })!
    const { at, width } = await pixelsOf(wrapped, 288)
    expect(at(1, 1)).toEqual([255, 255, 255, 255])
    // The hexagon's outline passes through the middle of its row; its inside is the plate.
    const darkest = Math.min(...Array.from({ length: width }, (_, x) => at(x, width / 2)[0]))
    expect(darkest).toBeLessThan(40)
  })
  it('pads a circle more than a square', () => {
    expect(wrap(cronosSvg, { ...white, shape: 'square' })).toContain('<svg x="8" y="8" width="84" height="84"')
    expect(wrap(cronosSvg, { ...white, shape: 'rounded' })).toContain('<svg x="10" y="10" width="80"')
  })
  it('drops the original root position and size, keeping a stroke-width untouched', () => {
    const wrapped = wrap(
      '<?xml version="1.0"?><svg x="3" y=\'4\' width="50" height=\'60\' viewBox="0 0 50 60" stroke-width="2"><rect/></svg>',
    )!
    expect(wrapped).toContain(
      '<svg x="15" y="15" width="70" height="70" viewBox="0 0 50 60" stroke-width="2"><rect/></svg>',
    )
    expect(wrapped).not.toContain('<?xml')
  })
  it('writes only numbers and the fixed colour into the plate', () => {
    const wrapped = wrap(cronosSvg)!
    expect(wrapped).toContain('fill="#ffffff"')
  })
  it.each([
    ['text that is not a document', 'hello'],
    ['no root tag end', '<svg viewBox="0 0 1 1"'],
    ['no closing tag', '<svg viewBox="0 0 1 1"/>'],
    ['no viewBox', '<svg width="10" height="10"></svg>'],
    ['a viewBox that is not four numbers', '<svg viewBox="0 0 1"></svg>'],
    ['a viewBox with a zero side', '<svg viewBox="0 0 0 5"></svg>'],
    ['a viewBox with text in it', '<svg viewBox="a b c d"></svg>'],
  ])('refuses %s', (_label, content) => {
    expect(wrap(content)).toBeNull()
  })
  it('accepts comma separated viewBox numbers', () => {
    expect(wrap('<svg viewBox="0,0,10,10"></svg>')).not.toBeNull()
  })
})

describe('plate size', () => {
  it('takes the requested side, the smaller of two', () => {
    const base = { intrinsic: {}, isVector: true, shape: 'circle' as const }
    expect(computePlateSide({ ...base, target: { w: 128, h: null } })).toBe(128)
    expect(computePlateSide({ ...base, target: { w: null, h: 64 } })).toBe(64)
    expect(computePlateSide({ ...base, target: { w: 128, h: 64 } })).toBe(64)
  })
  it('gives a vector a fixed side when no size is asked for', () => {
    expect(computePlateSide({ target: { w: null, h: null }, intrinsic: {}, isVector: true, shape: 'circle' })).toBe(
      PLATE_DEFAULT_VECTOR_SIDE,
    )
  })
  it('leaves a raster at its own size plus the padding', () => {
    expect(
      computePlateSide({
        target: { w: null, h: null },
        intrinsic: { width: 70, height: 35 },
        isVector: false,
        shape: 'circle',
      }),
    ).toBe(100)
    expect(computePlateSide({ target: { w: null, h: null }, intrinsic: {}, isVector: false, shape: 'square' })).toBe(2)
  })
  it('fits the logo inside the padding', () => {
    expect(plateInnerSide({ side: 100, shape: 'circle' })).toBe(70)
    expect(plateInnerSide({ side: 100, shape: 'square' })).toBe(84)
    expect(plateInnerSide({ side: 1, shape: 'circle' })).toBe(1)
  })
})

describe('renderPlatedRaster', () => {
  const red = () => sharp({ create: { width: 40, height: 40, channels: 3, background: '#ff0000' } }).png()
  const render = async (plate: Plate, format = 'png') => renderPlatedRaster({ logo: red(), side: 100, plate, format })

  it('puts the logo in the middle and the plate colour at a square corner', async () => {
    const { at, width, height } = await pixelsOf(await render({ ...white, shape: 'square' }))
    expect([width, height]).toEqual([100, 100])
    expect(at(1, 1)).toEqual([255, 255, 255, 255])
    expect(at(50, 50)).toEqual([255, 0, 0, 255])
  })
  it('leaves a circle corner empty and the edge of the circle painted', async () => {
    const { at } = await pixelsOf(await render({ colour: { red: 0, green: 0, blue: 255, alpha: 1 }, shape: 'circle' }))
    expect(at(1, 1)[3]).toBe(0)
    expect(at(50, 3)).toEqual([0, 0, 255, 255])
    expect(at(50, 50)).toEqual([255, 0, 0, 255])
  })
  it('rounds the corners of a rounded plate', async () => {
    const { at } = await pixelsOf(await render({ ...white, shape: 'rounded' }))
    expect(at(0, 0)[3]).toBe(0)
    expect(at(50, 2)).toEqual([255, 255, 255, 255])
  })
  it('keeps the plate alpha', async () => {
    const { at } = await pixelsOf(await render({ colour: { red: 0, green: 0, blue: 0, alpha: 0.5 }, shape: 'square' }))
    expect(at(1, 1)[3]).toBeGreaterThan(120)
    expect(at(1, 1)[3]).toBeLessThan(135)
  })
  it('fills the corners of a jpg white, since it cannot be transparent', async () => {
    const { at } = await pixelsOf(
      await render({ colour: { red: 0, green: 0, blue: 0, alpha: 1 }, shape: 'circle' }, 'jpeg'),
    )
    expect(
      at(1, 1)
        .slice(0, 3)
        .every((channel) => channel > 245),
    ).toBe(true)
    expect(
      at(50, 3)
        .slice(0, 3)
        .every((channel) => channel < 10),
    ).toBe(true)
  })
  it('does not enlarge a small logo', async () => {
    const tiny = sharp({ create: { width: 10, height: 10, channels: 3, background: '#00ff00' } }).png()
    const { at } = await pixelsOf(
      await renderPlatedRaster({ logo: tiny, side: 100, plate: { ...white, shape: 'square' }, format: 'png' }),
    )
    expect(at(50, 50)).toEqual([0, 255, 0, 255])
    expect(at(30, 50)).toEqual([255, 255, 255, 255])
  })
})
