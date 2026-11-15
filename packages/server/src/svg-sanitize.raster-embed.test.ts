import { beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { sanitizeImage } from './sanitize'
import { UNTRUSTED_INPUT, MAX_INPUT_PIXELS } from './untrusted-input'
import { palettePngClaiming, palettePngOf } from './__testing__/oversized-png'

/**
 * Embedded raster pictures inside a vector image. The fixtures are small and generated here, so no third-party logo
 * file is committed. Each test names the behaviour it protects.
 */

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'

/** A vector document holding one `image` element whose link is `href`, sized to 256 by 256. */
const imageDocument = (href: string): string =>
  `<svg ${NS} width="256" height="256"><image width="256" height="256" xlink:href="${href}"/></svg>`

/** The sanitized text of a vector document. */
const cleanText = async (svg: string): Promise<string> => (await sanitizeImage(Buffer.from(svg), '.svg')).toString()

/** The `xlink:href` value of the first element that has one in the cleaned text. */
const firstLinkOf = (cleaned: string): string | undefined => /xlink:href="([^"]*)"/.exec(cleaned)?.[1]

/** The mean of the red channel of the picture when the document is drawn. Zero when nothing is drawn. */
const redMeanWhenDrawn = async (svg: string): Promise<number> => {
  const { channels } = await sharp(Buffer.from(svg), UNTRUSTED_INPUT).resize(64, 64).stats()
  return channels[0].mean
}

/** A data address for `bytes` with the given declared media type and base64 encoding. */
const dataAddress = (declared: string, bytes: Buffer): string => `data:${declared};base64,${bytes.toString('base64')}`

let redPng: Buffer
let greenJpeg: Buffer
let blueGif: Buffer
let yellowWebp: Buffer
let orangeAvif: Buffer
let progressiveJpeg: Buffer
let palette6000Png: Buffer

beforeAll(async () => {
  const solid = (red: number, green: number, blue: number, side: number) =>
    sharp({ create: { width: side, height: side, channels: 3, background: { r: red, g: green, b: blue } } })
  redPng = await solid(255, 0, 0, 256).png().toBuffer()
  greenJpeg = await solid(0, 255, 0, 64).jpeg().toBuffer()
  progressiveJpeg = await solid(0, 255, 0, 64).jpeg({ progressive: true }).toBuffer()
  blueGif = await solid(0, 0, 255, 64).gif().toBuffer()
  yellowWebp = await solid(255, 255, 0, 64).webp().toBuffer()
  orangeAvif = await solid(255, 128, 0, 64).avif().toBuffer()
  palette6000Png = await solid(0, 0, 0, 6000).png({ palette: true }).toBuffer()
}, 120_000)

describe('mislabelled raster embeds', () => {
  it('relabels a PNG that is labelled img/png to image/png and keeps its bytes', async () => {
    const png = redPng.toString('base64')
    const cleaned = await cleanText(imageDocument(`data:img/png;base64,${png}`))
    expect(firstLinkOf(cleaned)).toBe(`data:image/png;base64,${png}`)
  })

  it('draws a relabelled PNG: the cleaned document is not blank when rendered', async () => {
    const cleaned = await cleanText(imageDocument(dataAddress('img/png', redPng)))
    expect(await redMeanWhenDrawn(cleaned)).toBeGreaterThan(0)
  })

  it('blanks a mislabelled non-image payload', async () => {
    const cleaned = await cleanText(
      imageDocument(`data:img/png;base64,${Buffer.from('not an image').toString('base64')}`),
    )
    expect(firstLinkOf(cleaned)).toBe('#')
  })

  it('relabels a mislabelled JPEG to image/jpeg, a progressive JPEG too', async () => {
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('img/jpeg', greenJpeg))))).toBe(
      dataAddress('image/jpeg', greenJpeg),
    )
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('img/jpeg', progressiveJpeg))))).toBe(
      dataAddress('image/jpeg', progressiveJpeg),
    )
  })

  it('relabels a mislabelled GIF to image/gif', async () => {
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('img/gif', blueGif))))).toBe(
      dataAddress('image/gif', blueGif),
    )
  })

  it('relabels a mislabelled WebP to image/webp', async () => {
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('img/webp', yellowWebp))))).toBe(
      dataAddress('image/webp', yellowWebp),
    )
  })

  it('blanks a mislabelled AVIF, because its size is not read from the header', async () => {
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('img/avif', orangeAvif))))).toBe('#')
  })

  it('relabels a payload labelled as a non-image media type (application/octet-stream) when it is a raster', async () => {
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('application/octet-stream', redPng))))).toBe(
      dataAddress('image/png', redPng),
    )
  })

  it('relabels a payload with no media type at all (data:;base64)', async () => {
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('', redPng))))).toBe(dataAddress('image/png', redPng))
  })

  it('removes the whitespace a base64 payload is wrapped with, as a browser ignores it', async () => {
    const wrapped = redPng.toString('base64').replace(/(.{60})/g, '$1\n')
    expect(firstLinkOf(await cleanText(imageDocument(`data:img/png;base64,${wrapped}`)))).toBe(
      dataAddress('image/png', redPng),
    )
  })

  it('blanks a mislabelled payload that is not an image', async () => {
    const text = Buffer.from('<html><script>alert(1)</script></html>')
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('img/png', text))))).toBe('#')
  })

  it('blanks a mislabelled vector payload and never relabels it to image/svg+xml', async () => {
    const vector = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const cleaned = await cleanText(imageDocument(dataAddress('img/svg', vector)))
    expect(firstLinkOf(cleaned)).toBe('#')
    expect(cleaned).not.toContain('image/svg+xml')
    expect(cleaned).not.toContain('alert')
  })

  it('blanks a mislabelled payload whose base64 holds a character outside the alphabet', async () => {
    expect(firstLinkOf(await cleanText(imageDocument('data:img/png;base64,iVBOR!!!!')))).toBe('#')
  })

  it('blanks a mislabelled payload whose base64 length is not a multiple of four', async () => {
    const png = redPng.toString('base64')
    expect(firstLinkOf(await cleanText(imageDocument(`data:img/png;base64,${png}A`)))).toBe('#')
  })

  it('blanks a mislabelled address that is not base64 (the payload is not relabelled)', async () => {
    const cleaned = await cleanText(imageDocument('data:img/png,%89PNG'))
    expect(firstLinkOf(cleaned)).toBe('#')
  })

  it('blanks a mislabelled address whose payload is a bare signature with no header', async () => {
    const signatureOnly = Buffer.from('89504e470d0a1a0a', 'hex')
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('img/png', signatureOnly))))).toBe('#')
  })
})

describe('mislabelled embeds outside an image element', () => {
  it('still blanks a mislabelled address on an anchor element', async () => {
    const png = dataAddress('img/png', redPng)
    const cleaned = await cleanText(`<svg ${NS}><a xlink:href="${png}"><text>x</text></a></svg>`)
    expect(cleaned).toContain('xlink:href="#"')
    expect(cleaned).not.toContain('data:')
  })

  it('still blanks a mislabelled address on a filter image element', async () => {
    const png = dataAddress('img/png', redPng)
    const cleaned = await cleanText(`<svg ${NS}><filter><feImage xlink:href="${png}"/></filter></svg>`)
    expect(cleaned).toContain('xlink:href="#"')
  })
})

describe('correctly labelled raster embeds', () => {
  it('keeps a correctly labelled PNG exactly as written', async () => {
    const value = dataAddress('image/png', redPng)
    expect(firstLinkOf(await cleanText(imageDocument(value)))).toBe(value)
  })

  it('draws a correctly labelled embed too', async () => {
    expect(await redMeanWhenDrawn(await cleanText(imageDocument(dataAddress('image/png', redPng))))).toBeGreaterThan(0)
  })

  it('rewrites a correctly typed JPEG whose label is image/jpg to image/jpeg', async () => {
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('image/jpg', greenJpeg))))).toBe(
      dataAddress('image/jpeg', greenJpeg),
    )
  })

  it('rewrites a raster labelled with the wrong image type to the type its bytes are', async () => {
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('image/gif', redPng))))).toBe(
      dataAddress('image/png', redPng),
    )
  })

  it('blanks a correctly labelled address that is not base64', async () => {
    expect(firstLinkOf(await cleanText(imageDocument('data:image/png,%89PNG')))).toBe('#')
  })

  it('blanks a correctly labelled image type that is not a raster format the sanitizer knows', async () => {
    const bitmap = Buffer.from('BM' + '\0'.repeat(60))
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('image/bmp', bitmap))))).toBe('#')
  })

  it('blanks a data address with no comma, so there is no payload to read', async () => {
    expect(firstLinkOf(await cleanText(imageDocument('data:image/png;base64')))).toBe('#')
  })

  it('blanks a data address whose parameters do not end in base64', async () => {
    const payload = redPng.toString('base64')
    expect(firstLinkOf(await cleanText(imageDocument(`data:image/png;charset=utf-8,${payload}`)))).toBe('#')
  })

  it('blanks a correctly labelled address whose bytes are not an image at all', async () => {
    const notAnImage = dataAddress('image/png', Buffer.from('plain text'))
    expect(firstLinkOf(await cleanText(imageDocument(notAnImage)))).toBe('#')
  })

  it('keeps a nested vector image address as it was (no change to the vector label)', async () => {
    const nested = dataAddress('image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))
    expect(firstLinkOf(await cleanText(imageDocument(nested)))).toBe(nested)
  })

  it('keeps a correctly labelled raster on an anchor element, as before', async () => {
    const value = dataAddress('image/png', redPng)
    expect(await cleanText(`<svg ${NS}><a xlink:href="${value}"><text>x</text></a></svg>`)).toContain(`href="${value}"`)
  })
})

describe('size of embedded rasters', () => {
  it('blanks an embedded PNG that claims 6000 by 6000 pixels, from its header alone', async () => {
    const claimed = palettePngClaiming(6000)
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('image/png', claimed))))).toBe('#')
  })

  it('blanks a real 6000 by 6000 palette PNG embedded under a correct label', async () => {
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('image/png', palette6000Png))))).toBe('#')
  })

  it('blanks a real 6000 by 6000 palette PNG embedded under a mislabel', async () => {
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('img/png', palette6000Png))))).toBe('#')
  })

  it('keeps an embed of exactly the pixel cap (5000 by 5000)', async () => {
    const side = Math.sqrt(MAX_INPUT_PIXELS)
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('image/png', palettePngClaiming(side)))))).toBe(
      dataAddress('image/png', palettePngClaiming(side)),
    )
  })

  it('blanks a second full-cap embed, because the first one spends the whole document budget', async () => {
    const full = dataAddress('image/png', palettePngClaiming(5000))
    const cleaned = await cleanText(
      `<svg ${NS} width="256" height="256"><image xlink:href="${full}"/><image xlink:href="${full}"/></svg>`,
    )
    expect(cleaned.match(/xlink:href="#"/g)).toHaveLength(1)
    expect(cleaned).toContain(`xlink:href="${full}"`)
  })

  it('blanks an embed one column past the cap (5001 by 5000)', async () => {
    const oneMoreColumn = dataAddress('image/png', palettePngOf(5001, 5000))
    expect(firstLinkOf(await cleanText(imageDocument(oneMoreColumn)))).toBe('#')
  })

  it('bounds the total pixels of all embeds in one document, blanking those past the budget', async () => {
    const embed = dataAddress('image/png', palettePngClaiming(3000))
    const images = [1, 2, 3].map(() => `<image width="256" height="256" xlink:href="${embed}"/>`).join('')
    const cleaned = await cleanText(`<svg ${NS} width="256" height="256">${images}</svg>`)
    // 3000 by 3000 is 9 million pixels: two fit in the 25 million budget, the third does not.
    expect(cleaned.match(/xlink:href="#"/g)).toHaveLength(1)
    expect(cleaned.match(/xlink:href="data:image\/png;base64,/g)).toHaveLength(2)
  })

  it('does not charge the budget for a blanked embed (a later embed still fits)', async () => {
    const oversized = dataAddress('image/png', palettePngClaiming(6000))
    const small = dataAddress('image/png', palettePngClaiming(3000))
    const cleaned = await cleanText(
      `<svg ${NS} width="256" height="256"><image xlink:href="${oversized}"/><image xlink:href="${small}"/></svg>`,
    )
    expect(cleaned.match(/xlink:href="#"/g)).toHaveLength(1)
    expect(cleaned).toContain(`xlink:href="${small}"`)
  })

  it('blanks an embed whose dimensions cannot be read (a truncated PNG header)', async () => {
    const truncated = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('0000000d49484452', 'hex')])
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('image/png', truncated))))).toBe('#')
  })

  it('blanks a JPEG with no frame header', async () => {
    const noFrame = Buffer.from('ffd8ffd9', 'hex')
    expect(firstLinkOf(await cleanText(imageDocument(dataAddress('image/jpeg', noFrame))))).toBe('#')
  })

  it('reads the size of an embedded picture on any element that draws it, as feImage does', async () => {
    const oversized = dataAddress('image/png', palettePngClaiming(6000))
    const cleaned = await cleanText(`<svg ${NS}><filter><feImage xlink:href="${oversized}"/></filter></svg>`)
    expect(cleaned).toContain('xlink:href="#"')
  })
})

describe('the 12000 by 12000 embed', () => {
  it('blanks an embed of 12000 by 12000 pixels that is correctly labelled (header read, no decode)', async () => {
    const huge = dataAddress('image/png', palettePngClaiming(12000))
    expect(firstLinkOf(await cleanText(imageDocument(huge)))).toBe('#')
  })
})
