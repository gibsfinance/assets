import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import {
  PLATE_VISIBLE_SHARE_THRESHOLD,
  PLATE_DEFAULT_VECTOR_SIDE,
  CONTRAST_PLATE_COLOUR,
  computePlateSide,
  contrastRatio,
  createVisibilityCache,
  createFailureMemory,
  findTagEnd,
  plateDocument,
  VisibilityUnavailableError,
  logoNeedsPlate,
  measureVisibleShares,
  parseHexColour,
  parsePlateRequest,
  plateInnerSide,
  plateShapeMarkup,
  relativeLuminance,
  renderPlatedRaster,
  resolvePlate,
  visibleShares,
  type VisibleShares,
  wrapSvgWithPlate,
  type Plate,
} from './plate'

/** The file https://staging.gib.show/image/25 served (Cronos, web3icons, MIT): a dark navy hexagon. */
const cronosSvg = readFileSync(new URL('./__fixtures__/cronos-web3icons.svg', import.meta.url))
/** The file https://staging.gib.show/image/1 served (Ethereum, SmolDapp tokenAssets, MIT): a blue disc with a white glyph. */
const ethereumSvg = readFileSync(new URL('./__fixtures__/ethereum-smoldapp.svg', import.meta.url))
/** Half black, half white: neither half hides the other, so it is visible on any page. */
const twoToneSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="12" height="24" fill="#000"/><rect x="12" width="12" height="24" fill="#fff"/></svg>',
)
/** One mid-grey square. */
const greySvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#777"/></svg>',
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

describe('visibleShares', () => {
  it('counts the share of visible pixels that stand out against each page, weighted by alpha', () => {
    // White opaque, black opaque: white stands out on dark, black on light, one each.
    expect(visibleShares(Uint8Array.of(255, 255, 255, 255, 0, 0, 0, 255))).toEqual({ dark: 0.5, light: 0.5 })
    // A transparent black pixel adds nothing to either side.
    expect(visibleShares(Uint8Array.of(255, 255, 255, 255, 0, 0, 0, 0))).toEqual({ dark: 1, light: 0 })
  })
  it('weights a half-transparent pixel as half', () => {
    // 3 parts white (alpha 1) against 1 part black (alpha 1) is 0.75 on dark; halving the black halves its weight.
    const shares = visibleShares(Uint8Array.of(255, 255, 255, 255, 0, 0, 0, 128))
    expect(shares!.dark).toBeCloseTo(255 / (255 + 128))
  })
  it('is null when nothing is visible', () => {
    expect(visibleShares(Uint8Array.of(255, 255, 255, 0))).toBeNull()
    expect(visibleShares(new Uint8Array())).toBeNull()
  })
})

describe('measureVisibleShares on real logos', () => {
  const measure = (svg: Buffer, density: number) => measureVisibleShares(sharp(svg, { density }))

  it('finds the Cronos logo invisible on a dark page and fully visible on a light one', async () => {
    const shares = await measure(cronosSvg, 192)
    expect(shares!.dark).toBeLessThan(0.01)
    expect(shares!.light).toBeGreaterThan(0.99)
  })
  it('finds the Ethereum logo visible on a dark page, and mostly visible on a light one', async () => {
    const shares = await measure(ethereumSvg, 144)
    expect(shares!.dark).toBeGreaterThan(0.99)
    // The white glyph vanishes on white, but the blue disc around it does not: the average would hide that.
    expect(shares!.light).toBeGreaterThan(0.7)
    expect(shares!.light).toBeLessThan(0.85)
  })
  it('finds a half black, half white logo visible on both pages', async () => {
    const shares = await measure(twoToneSvg, 192)
    expect(shares!.dark).toBeCloseTo(0.5, 1)
    expect(shares!.light).toBeCloseTo(0.5, 1)
  })
  it('finds a uniform mid-grey visible on both pages', async () => {
    const shares = await measure(greySvg, 192)
    expect(shares).toEqual({ dark: 1, light: 1 })
  })
  it('measures a greyscale picture with no alpha channel', async () => {
    const grey = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } })
      .greyscale()
      .png()
      .toBuffer()
    expect(await measureVisibleShares(sharp(grey))).toEqual({ dark: 1, light: 0 })
  })
  it('is null for a fully transparent picture', async () => {
    const clear = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer()
    expect(await measureVisibleShares(sharp(clear))).toBeNull()
  })
})

describe('resolvePlate', () => {
  /** Shares measured from the real files (see above), or the nearest round value. */
  const cronos: VisibleShares = { dark: 0, light: 1 }
  const ethereum: VisibleShares = { dark: 1, light: 0.78 }
  const twoTone: VisibleShares = { dark: 0.5, light: 0.5 }
  const never = vi.fn().mockRejectedValue(new Error('must not measure'))
  const sharesOf = (value: VisibleShares | null) => vi.fn().mockResolvedValue(value)
  const request = (overrides: Partial<Parameters<typeof resolvePlate>[0]['request']>) => ({
    colour: null,
    shape: 'circle' as const,
    contrast: null,
    ...overrides,
  })
  const decide = (contrast: 'dark' | 'light', shares: VisibleShares | null) =>
    resolvePlate({ request: request({ contrast }), measureShares: sharesOf(shares) })

  it('plates Cronos on a dark page and not on a light one', async () => {
    expect(await decide('dark', cronos)).toEqual({ colour: CONTRAST_PLATE_COLOUR.dark, shape: 'circle' })
    expect(await decide('light', cronos)).toBeNull()
  })
  it('plates Ethereum on neither page', async () => {
    expect(await decide('dark', ethereum)).toBeNull()
    expect(await decide('light', ethereum)).toBeNull()
  })
  it('plates a logo of mixed parts on neither page', async () => {
    expect(await decide('dark', twoTone)).toBeNull()
    expect(await decide('light', twoTone)).toBeNull()
  })
  it('adds a dark plate to a pale logo on a light page', async () => {
    const plate = await decide('light', { dark: 1, light: 0 })
    expect(plate!.colour.red).toBeLessThan(50)
  })
  it('draws the line at the named share', () => {
    const at = (share: number) => logoNeedsPlate({ shares: { dark: share, light: share }, contrast: 'dark' })
    expect(at(PLATE_VISIBLE_SHARE_THRESHOLD - 0.01)).toBe(true)
    expect(at(PLATE_VISIBLE_SHARE_THRESHOLD)).toBe(false)
  })
  it('adds nothing when nothing is visible', async () => {
    expect(await decide('dark', null)).toBeNull()
  })
  it('paints bg without measuring anything', async () => {
    const colour = { red: 1, green: 2, blue: 3, alpha: 1 }
    const plate = await resolvePlate({ request: request({ colour, shape: 'square' }), measureShares: never })
    expect(plate).toEqual({ colour, shape: 'square' })
    expect(never).not.toHaveBeenCalled()
  })
  it('uses bg as the colour when contrast says a plate is needed', async () => {
    const colour = { red: 200, green: 0, blue: 0, alpha: 1 }
    const plate = await resolvePlate({
      request: request({ colour, contrast: 'dark' }),
      measureShares: sharesOf(cronos),
    })
    expect(plate!.colour).toBe(colour)
  })
  it('lets contrast withhold the bg plate', async () => {
    const colour = { red: 200, green: 0, blue: 0, alpha: 1 }
    expect(
      await resolvePlate({ request: request({ colour, contrast: 'dark' }), measureShares: sharesOf(ethereum) }),
    ).toBeNull()
  })
  it('draws nothing for a request that names neither colour nor contrast', async () => {
    expect(await resolvePlate({ request: request({}), measureShares: never })).toBeNull()
  })
})

describe('createVisibilityCache', () => {
  it('measures a key once, including a null answer', async () => {
    const cache = createVisibilityCache()
    const measure = vi.fn().mockResolvedValue(null)
    expect(await cache.remember('a', measure)).toBeNull()
    expect(await cache.remember('a', measure)).toBeNull()
    expect(measure).toHaveBeenCalledTimes(1)
    expect(cache.size).toBe(1)
  })
  it('drops the oldest entry when full', async () => {
    const cache = createVisibilityCache({ limit: 2 })
    for (const key of ['a', 'b', 'c']) await cache.remember(key, async () => ({ dark: 0.5, light: 0.5 }))
    expect(cache.size).toBe(2)
    const again = vi.fn().mockResolvedValue({ dark: 0.1, light: 0.1 })
    await cache.remember('a', again)
    expect(again).toHaveBeenCalledTimes(1)
    const kept = vi.fn().mockResolvedValue({ dark: 0.1, light: 0.1 })
    await cache.remember('c', kept)
    expect(kept).not.toHaveBeenCalled()
  })
  it('works with the default limit', () => {
    expect(createVisibilityCache().size).toBe(0)
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
    const base = { intrinsic: {}, isVector: true, shape: 'circle' as const, maxSide: 2048 }
    expect(computePlateSide({ ...base, target: { w: 128, h: null } })).toBe(128)
    expect(computePlateSide({ ...base, target: { w: null, h: 64 } })).toBe(64)
    expect(computePlateSide({ ...base, target: { w: 128, h: 64 } })).toBe(64)
  })
  it('gives a vector a fixed side when no size is asked for', () => {
    expect(
      computePlateSide({ target: { w: null, h: null }, intrinsic: {}, isVector: true, shape: 'circle', maxSide: 2048 }),
    ).toBe(PLATE_DEFAULT_VECTOR_SIDE)
  })
  it('leaves a raster at its own size plus the padding', () => {
    expect(
      computePlateSide({
        target: { w: null, h: null },
        intrinsic: { width: 70, height: 35 },
        isVector: false,
        shape: 'circle',
        maxSide: 2048,
      }),
    ).toBe(100)
    expect(
      computePlateSide({
        target: { w: null, h: null },
        intrinsic: {},
        isVector: false,
        shape: 'square',
        maxSide: 2048,
      }),
    ).toBe(2)
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

describe('plate side is bounded', () => {
  const raster = { isVector: false, shape: 'circle' as const, target: { w: null, h: null } }
  it('never draws a raster past maxSide, however large the source', () => {
    // 8000 px asks for 8000 / 0.7 = 11429 px unbounded, which is a canvas of about 520 MB.
    expect(computePlateSide({ ...raster, intrinsic: { width: 8000, height: 8000 }, maxSide: 2048 })).toBe(2048)
  })
  it('still adds the padding to a raster that fits', () => {
    expect(computePlateSide({ ...raster, intrinsic: { width: 700, height: 700 }, maxSide: 2048 })).toBe(
      Math.ceil(700 / 0.7),
    )
  })
  it('bounds a requested side and the vector default too', () => {
    expect(computePlateSide({ ...raster, intrinsic: {}, target: { w: 4000, h: null }, maxSide: 2048 })).toBe(2048)
    expect(computePlateSide({ ...raster, intrinsic: {}, isVector: true, maxSide: 100 })).toBe(100)
  })
})

describe('findTagEnd', () => {
  it('skips a > inside a quoted attribute, whichever quote is used', () => {
    expect(findTagEnd('<svg a="x>y" b=\'p>q\'>', 0)).toBe(20)
  })
  it('ends at the first unquoted >', () => {
    expect(findTagEnd('<svg a="1">text>', 0)).toBe(10)
  })
  it('is -1 when the tag, or a quote in it, never ends', () => {
    expect(findTagEnd('<svg a="1"', 0)).toBe(-1)
    expect(findTagEnd('<svg a="1>', 0)).toBe(-1)
  })
})

describe('wrapSvgWithPlate falls back instead of writing broken markup', () => {
  const wrap = (content: string | Buffer) => wrapSvgWithPlate({ content: Buffer.from(content), plate: white })
  const body = '<rect width="1" height="1"/></svg>'

  it('keeps a > inside a quoted root attribute inside the root tag', async () => {
    const wrapped = wrap(`<svg viewBox="0 0 10 10" data-note="a > b" width="9">${body}`)!.toString('utf8')
    expect(wrapped).toContain('<svg x="15" y="15" width="70" height="70" viewBox="0 0 10 10" data-note="a > b">')
    expect(wrapped).not.toContain('width="9"')
    // The attribute stayed inside its tag, so the whole document is well formed and a renderer opens it.
    expect((await sharp(Buffer.from(wrapped)).metadata()).format).toBe('svg')
  })
  it('refuses a document with a type declaration, whose entities would be lost', () => {
    expect(wrap(`<!DOCTYPE svg [<!ENTITY c "#f00">]><svg viewBox="0 0 10 10"><rect fill="&c;"/></svg>`)).toBeNull()
    expect(
      wrap(
        `<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg viewBox="0 0 1 1">${body}`,
      ),
    ).toBeNull()
  })
  it('refuses an encoding other than UTF-8, in either quote', () => {
    expect(wrap(`<?xml version="1.0" encoding="ISO-8859-1"?><svg viewBox="0 0 1 1">${body}`)).toBeNull()
    expect(wrap(`<?xml version='1.0' encoding='UTF-16'?><svg viewBox="0 0 1 1">${body}`)).toBeNull()
  })
  it('accepts a declared UTF-8, in any case or spelling', () => {
    expect(wrap(`<?xml version="1.0" encoding="UTF-8"?><svg viewBox="0 0 1 1">${body}`)).not.toBeNull()
    expect(wrap(`<?xml version="1.0" encoding="utf8"?><svg viewBox="0 0 1 1">${body}`)).not.toBeNull()
  })
  it('refuses a document that is really UTF-16, read here as bytes of UTF-8', () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<svg viewBox="0 0 1 1"></svg>', 'utf16le')])
    expect(wrap(utf16)).toBeNull()
  })
  it('refuses a root tag that only appears inside a comment or after other markup', () => {
    expect(wrap(`<!-- <svg viewBox="0 0 1 1"> --><p/>${body}`)).toBeNull()
    expect(wrap(`<p/><svg viewBox="0 0 1 1">${body}`)).toBeNull()
  })
  it('refuses markup after the closing tag, other than comments and white space', () => {
    expect(wrap(`<svg viewBox="0 0 1 1">${body}<p>tail</p>`)).toBeNull()
    expect(wrap(`<svg viewBox="0 0 1 1">${body}\n<!-- end -->\n`)).not.toBeNull()
  })
  it('accepts comments and a byte order mark before the root', () => {
    expect(wrap(`${String.fromCharCode(0xfeff)}<!-- logo --><svg viewBox="0 0 1 1">${body}`)).not.toBeNull()
  })
  it('does not take <svgfoo> for the root', () => {
    expect(wrap(`<svgfoo viewBox="0 0 1 1">${body}`)).toBeNull()
  })
})

describe('plateDocument', () => {
  it('writes the underlay, then the plate, then the body, and a size only when given', () => {
    const doc = plateDocument({ plate: white, underlay: '<u/>', body: '<b/>', size: 50 })
    expect(doc).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 100 100"><u/><circle cx="50" cy="50" r="50" fill="#ffffff"/><b/></svg>',
    )
    expect(plateDocument({ plate: white })).not.toContain('width=')
  })
})

describe('createFailureMemory', () => {
  it('remembers a failure until its time is up, then forgets it', () => {
    let clock = 0
    const memory = createFailureMemory({ ttlMs: 100, now: () => clock })
    memory.record('a')
    expect(memory.has('a')).toBe(true)
    expect(memory.has('b')).toBe(false)
    clock = 99
    expect(memory.has('a')).toBe(true)
    clock = 100
    expect(memory.has('a')).toBe(false)
    expect(memory.size).toBe(0)
  })
  it('drops the oldest when full, and a repeat renews the time', () => {
    let clock = 0
    const memory = createFailureMemory({ ttlMs: 100, limit: 2, now: () => clock })
    memory.record('a')
    memory.record('b')
    clock = 50
    memory.record('a')
    memory.record('c')
    expect(memory.has('b')).toBe(false)
    expect(memory.has('a')).toBe(true)
    expect(memory.has('c')).toBe(true)
  })
  it('works with the production defaults', () => {
    const memory = createFailureMemory()
    memory.record('x')
    expect(memory.has('x')).toBe(true)
  })
})

describe('createVisibilityCache sharing and failure', () => {
  const shares = { dark: 0.5, light: 0.5 }

  it('lets requests that arrive together share one measurement', async () => {
    const cache = createVisibilityCache()
    let release = () => {}
    const measure = vi.fn(
      () =>
        new Promise<VisibleShares>((resolve) => {
          release = () => resolve(shares)
        }),
    )
    const first = cache.remember('a', measure)
    const second = cache.remember('a', measure)
    release()
    expect(await Promise.all([first, second])).toEqual([shares, shares])
    expect(measure).toHaveBeenCalledTimes(1)
  })
  it('remembers a failure, rethrows it without measuring again, and logs once', async () => {
    const onFailure = vi.fn()
    const cache = createVisibilityCache({ onFailure })
    const boom = new Error('cannot decode')
    const measure = vi.fn().mockRejectedValue(boom)
    await expect(cache.remember('a', measure)).rejects.toBeInstanceOf(VisibilityUnavailableError)
    await expect(cache.remember('a', measure)).rejects.toBeInstanceOf(VisibilityUnavailableError)
    expect(measure).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledWith('a', boom)
    expect(cache.size).toBe(0)
  })
  it('carries the cause on the error the first caller sees', async () => {
    const cache = createVisibilityCache()
    const boom = new Error('cannot decode')
    const error = await cache.remember('a', () => Promise.reject(boom)).catch((caught) => caught)
    expect(error.cause).toBe(boom)
    expect(error.name).toBe('VisibilityUnavailableError')
  })
  it('measures again once the failure window has passed', async () => {
    let clock = 0
    const cache = createVisibilityCache({ failureTtlMs: 100, now: () => clock })
    await cache.remember('a', () => Promise.reject(new Error('x'))).catch(() => {})
    clock = 100
    expect(await cache.remember('a', async () => shares)).toEqual(shares)
  })
  it('lets every request that shared a failing measurement see the failure', async () => {
    const cache = createVisibilityCache()
    const measure = () => Promise.reject(new Error('x'))
    const settled = await Promise.allSettled([cache.remember('a', measure), cache.remember('a', measure)])
    expect(settled.map((result) => result.status)).toEqual(['rejected', 'rejected'])
  })
})

describe('renderPlatedRaster, jpg, drawn once', () => {
  it('has a white corner and is a real jpeg', async () => {
    const logo = sharp({ create: { width: 40, height: 40, channels: 3, background: '#ff0000' } }).png()
    const body = await renderPlatedRaster({ logo, side: 100, plate: { ...white, shape: 'circle' }, format: 'jpeg' })
    expect((await sharp(body).metadata()).format).toBe('jpeg')
    const { at } = await pixelsOf(body)
    expect(
      at(0, 0)
        .slice(0, 3)
        .every((channel) => channel > 245),
    ).toBe(true)
  })
})
