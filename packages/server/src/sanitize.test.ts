import { describe, it, expect } from 'vitest'
import { ImageRejectedError, SvgRejectedError, sanitizeImage, decodeCharacterReferences, isScriptUri } from './sanitize'

describe('sanitizeImage', () => {
  describe('SVG sanitization', () => {
    it('strips <script> elements', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/><script>alert("xss")</script></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('<script')
      expect(output).not.toContain('alert')
      expect(output).toContain('<circle')
    })

    it('strips <foreignObject> elements', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>html</div></foreignObject><rect width="10" height="10"/></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('<foreignObject')
      expect(output).toContain('<rect')
    })

    it('strips onclick and other event handlers', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10" onclick="alert(1)" onmouseover="steal()"/></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('onclick')
      expect(output).not.toContain('onmouseover')
      expect(output).toContain('<circle')
    })

    it('strips javascript: URIs in href', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>click</text></a></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('javascript:')
    })

    it('strips <use> elements with external refs', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.com/payload.svg#icon"/></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('evil.com')
    })

    it('preserves valid SVG content', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#ff0000"/><path d="M10 10 L90 90" stroke="black"/></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).toContain('<circle')
      expect(output).toContain('fill="#ff0000"')
      expect(output).toContain('<path')
      expect(output).toContain('viewBox')
    })

    it('strips <iframe> elements', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><iframe src="https://evil.com"/></svg>')
      const result = await sanitizeImage(svg, '.svg')
      expect(result.toString()).not.toContain('<iframe')
    })

    it('strips non-image data: URIs', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;"><text>x</text></a></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('data:text/html')
    })

    it('preserves data:image URIs', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,iVBORw0KGgo="/></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).toContain('data:image/png')
    })

    it('strips animate elements that target href', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="#"><animate attributeName="href" to="javascript:alert(1)"/><text>x</text></a></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('<animate')
    })

    it('handles case-insensitive element names', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><SCRIPT>alert(1)</SCRIPT><circle r="5"/></svg>')
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('SCRIPT')
      expect(output).not.toContain('alert')
      expect(output).toContain('<circle')
    })

    it('strips CSS @import rules', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("https://evil.com/styles.css");</style><circle r="5"/></svg>',
      )
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('@import')
      expect(output).not.toContain('evil.com')
      expect(output).toContain('<circle')
    })

    it('strips file:// protocol URIs', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>')
      const result = await sanitizeImage(svg, '.svg')
      const output = result.toString()
      expect(output).not.toContain('file://')
      expect(output).not.toContain('/etc/passwd')
    })
  })

  describe('raster sanitization', () => {
    it('re-encodes PNG through sharp', async () => {
      // Create a minimal 1x1 red PNG
      const sharp = (await import('sharp')).default
      const original = await sharp({
        create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
      })
        .png()
        .toBuffer()

      const result = await sanitizeImage(original, '.png')
      // Result should still be a valid PNG
      expect(result[0]).toBe(0x89) // PNG magic byte
      expect(result[1]).toBe(0x50) // P
      expect(result[2]).toBe(0x4e) // N
      expect(result[3]).toBe(0x47) // G
    })

    it('re-encodes JPEG through sharp', async () => {
      const sharp = (await import('sharp')).default
      const original = await sharp({
        create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 255 } },
      })
        .jpeg()
        .toBuffer()

      const result = await sanitizeImage(original, '.jpg')
      // Result should still be a valid JPEG (starts with FF D8)
      expect(result[0]).toBe(0xff)
      expect(result[1]).toBe(0xd8)
    })

    it('re-encodes WebP through sharp', async () => {
      const sharp = (await import('sharp')).default
      const original = await sharp({
        create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
      })
        .webp()
        .toBuffer()

      const result = await sanitizeImage(original, '.webp')
      // RIFF header for WebP
      expect(result.toString('ascii', 0, 4)).toBe('RIFF')
    })

    it('refuses a raster format that has no re-encoder, instead of storing it as downloaded', async () => {
      for (const ext of ['.apng', '.bmp', '.tif', '.tiff', '.ico', '.heic', '.jxl', '.xyz']) {
        await expect(sanitizeImage(Buffer.from('not a real image format'), ext)).rejects.toBeInstanceOf(
          ImageRejectedError,
        )
      }
    })

    it('refuses a raster that sharp cannot decode, instead of storing it as downloaded', async () => {
      const corrupt = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]) // truncated PNG header
      await expect(sanitizeImage(corrupt, '.png')).rejects.toThrow(/sharp cannot decode this \.png/)
      await expect(sanitizeImage(corrupt, '.png')).rejects.toBeInstanceOf(ImageRejectedError)
    })

    it('throws the same kind of error for a vector file that is not well formed', async () => {
      await expect(sanitizeImage(Buffer.from('<svg'), '.svg')).rejects.toBeInstanceOf(ImageRejectedError)
      await expect(sanitizeImage(Buffer.from('<svg'), '.svg')).rejects.toBeInstanceOf(SvgRejectedError)
    })

    describe('animation', () => {
      const FRAME_DELAY_MS = 120
      /** Two solid frames stacked into one tall image, written as an animation with a known delay. */
      const animated = async (format: 'gif' | 'webp'): Promise<Buffer> => {
        const sharp = (await import('sharp')).default
        const frame = (color: string) =>
          sharp({ create: { width: 8, height: 8, channels: 4, background: color } })
            .raw()
            .toBuffer()
        const stacked = Buffer.concat([await frame('#ff0000'), await frame('#0000ff')])
        return sharp(stacked, { raw: { width: 8, height: 16, channels: 4, pageHeight: 8 } as never })
          .toFormat(format, { delay: [FRAME_DELAY_MS, FRAME_DELAY_MS], loop: 0 } as never)
          .toBuffer()
      }
      const pagesOf = async (image: Buffer) => {
        const sharp = (await import('sharp')).default
        return (await sharp(image, { animated: true }).metadata()).pages
      }

      it.each(['gif', 'webp'] as const)('keeps both frames of an animated %s', async (format) => {
        const original = await animated(format)
        expect(await pagesOf(original)).toBe(2)

        const result = await sanitizeImage(original, `.${format}`)

        // Without { animated: true } sharp reads one frame and the file comes back as a still.
        expect(await pagesOf(result)).toBe(2)
        const sharp = (await import('sharp')).default
        const meta = await sharp(result, { animated: true }).metadata()
        expect(meta.delay).toEqual([FRAME_DELAY_MS, FRAME_DELAY_MS])
        expect(meta.loop).toBe(0)
      })

      it('keeps the picture of each frame, not only the count', async () => {
        const sharp = (await import('sharp')).default
        const result = await sanitizeImage(await animated('gif'), '.gif')
        const { data, info } = await sharp(result, { animated: true }).raw().toBuffer({ resolveWithObject: true })
        const pixelOfFrame = (frame: number) => (frame * info.pageHeight! * info.width + 0) * info.channels
        expect(data[pixelOfFrame(0)]).toBeGreaterThan(200) // red
        expect(data[pixelOfFrame(1) + 2]).toBeGreaterThan(200) // blue
      })

      it('does not turn a still gif or webp into an animation', async () => {
        const sharp = (await import('sharp')).default
        const still = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#00ff00' } })
          .gif()
          .toBuffer()
        expect(await pagesOf(await sanitizeImage(still, '.gif'))).toBe(1)
      })
    })
  })
})

describe('script links written with character references', () => {
  const clean = async (attributes: string) => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:x="http://www.w3.org/1999/xlink"><a ${attributes}><text>x</text></a></svg>`,
    )
    return (await sanitizeImage(svg, '.svg')).toString()
  }

  it.each([
    ['a decimal reference for the first letter', 'href="&#106;avascript:alert(1)"'],
    ['a hex reference for the first letter', 'href="&#x6A;avascript:alert(1)"'],
    ['references for the whole word', 'href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)"'],
    ['a reference for the colon', 'href="javascript&#58;alert(1)"'],
    ['a tab written as a reference inside the word', 'href="java&#x09;script:alert(1)"'],
    ['a literal tab and line break inside the word', 'href="java\t\nscript:alert(1)"'],
    ['leading spaces and control characters', 'href="  \u0001 javascript:alert(1)"'],
    ['capital letters', 'href="JaVaScRiPt:alert(1)"'],
    ['a reference inside a reference', 'href="&amp;#106;avascript:alert(1)"'],
    ['vbscript', 'href="vbscript:msgbox(1)"'],
    ['a namespaced link attribute', 'xlink:href="&#106;avascript:alert(1)"'],
    ['a link attribute under another prefix', 'x:href="&#106;avascript:alert(1)"'],
    ['a src attribute', 'src="&#106;avascript:alert(1)"'],
    ['single quotes', "href='&#106;avascript:alert(1)'"],
    // A value may hold the other kind of quote; the link must still be checked.
    ['a single quote inside a double-quoted value', `href="javascript:alert('x')"`],
    ['a double quote inside a single-quoted value', `href='javascript:alert("x")'`],
  ])('neutralises %s', async (_label, attributes) => {
    const output = await clean(attributes)
    expect(output).toMatch(/="#"|='#'/)
    expect(output).not.toMatch(/alert|msgbox/)
    // The link attribute is still well formed: its closing quote is there.
    expect(output).toContain('><text>x</text></a>')
  })

  // These are references a browser reads in HTML but that are not XML: an SVG file is XML, so the parser
  // refuses the whole document and nothing is stored.
  it.each([
    ['references with no semicolon', 'href="&#106avascript:alert(1)"'],
    ['a named reference for the colon', 'href="javascript&colon;alert(1)"'],
    ['a named tab inside the word', 'href="java&Tab;script:alert(1)"'],
    ['a named line break inside the word', 'href="java&NewLine;script:alert(1)"'],
    ['an unescaped angle bracket in a value', 'href="data:text/html,<script>alert(1)</script>"'],
  ])('rejects the document for %s', async (_label, attributes) => {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><a ${attributes}><text>x</text></a></svg>`)
    await expect(sanitizeImage(svg, '.svg')).rejects.toBeInstanceOf(SvgRejectedError)
  })

  it('leaves ordinary links alone, including one that mentions javascript in a path', async () => {
    const output = await clean('href="https://example.com/javascript:tutorial" xlink:href="#icon"')
    expect(output).toContain('href="https://example.com/javascript:tutorial"')
    expect(output).toContain('xlink:href="#icon"')
  })

  it('leaves a reference that is not a scheme, and an unknown or huge one, as written', async () => {
    const output = await clean('href="/a&amp;b?x=&#x41;"')
    expect(output).toContain('href="/a&amp;b?x=A"')
  })

  it('strips an animation that targets href when the target is written with references', async () => {
    for (const target of ['&#104;ref', 'xlink:&#104;ref', '&#x78;link:href']) {
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg"><a href="#"><set attributeName="${target}" to="&#106;avascript:alert(1)"/><text>x</text></a></svg>`,
      )
      const output = (await sanitizeImage(svg, '.svg')).toString()
      expect(output).not.toContain('<set')
      expect(output).not.toContain('alert')
    }
  })

  it('strips an animation that targets href when an earlier attribute value holds a ">"', async () => {
    for (const before of [`data-x="a>b"`, `data-x='a>b'`, `begin="0s" data-y="x>y>z"`]) {
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg"><a href="#"><set ${before} attributeName="href" to="javascript:alert(1)"/><text>x</text></a></svg>`,
      )
      const output = (await sanitizeImage(svg, '.svg')).toString()
      expect(output).not.toContain('<set')
      expect(output).not.toContain('alert')
    }
  })

  it('keeps an animation that targets something else', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"><animate attributeName="r" to="5"/></circle></svg>',
    )
    const output = (await sanitizeImage(svg, '.svg')).toString()
    expect(output).toContain('<animate attributeName="r" to="5"/>')
  })
})

describe('isScriptUri and decodeCharacterReferences', () => {
  it('decodes numeric and hex references, with and without a semicolon, and stops when nothing changes', () => {
    expect(decodeCharacterReferences('&#65;&#x42;&#67&#x44')).toBe('ABCD')
    expect(decodeCharacterReferences('plain text')).toBe('plain text')
    expect(decodeCharacterReferences('&amp;amp;amp;amp;')).toBe('&amp;')
  })
  it('reads a value the way a browser does', () => {
    expect(isScriptUri('JAVA\tSCRIPT:1')).toBe(true)
    expect(isScriptUri('&#106;avascript:1')).toBe(true)
    expect(isScriptUri('https://example.com')).toBe(false)
    expect(isScriptUri('#javascript:')).toBe(false)
    expect(isScriptUri('')).toBe(false)
  })
})
