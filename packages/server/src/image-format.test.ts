import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { detectImageExt, looksLikeSvg, servableExt, SERVABLE_IMAGE_EXTS } from './image-format'

const buf = (text: string) => Buffer.from(text, 'utf-8')

/**
 * An IPFS gateway directory listing, trimmed to its shape. This is the exact
 * content that reached the image store: the collector followed an icon URI to a
 * directory instead of a file, and the gateway answered with an HTML index whose
 * file-type glyphs are inline SVG.
 */
const IPFS_DIRECTORY_LISTING = buf(
  `<!DOCTYPE html>
<html>
  <head><title>A directory of content-addressed files hosted on IPFS</title></head>
  <body>
    <div class="ipfs-_blank">
      <svg width="16" height="16" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>
      <a href="/ipfs/QmExample/logo.png">logo.png</a>
    </div>
  </body>
</html>`,
)

describe('looksLikeSvg', () => {
  it('accepts a bare svg root element', () => {
    expect(looksLikeSvg(buf('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'))).toBe(true)
  })

  it('accepts an svg behind a declaration, doctype, and comment preamble', () => {
    const svg = buf(
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<!-- Generator: some vendor toolchain -->
<!-- Copyright notice spanning
     several lines -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle r="8"/></svg>`,
    )
    expect(looksLikeSvg(svg)).toBe(true)
  })

  it('accepts an svg with a byte-order mark', () => {
    expect(looksLikeSvg(Buffer.from('\uFEFF<svg viewBox="0 0 8 8"/>', 'utf-8'))).toBe(true)
  })

  // The regression this module exists for. The previous predicate — "more than two
  // '<' characters" — typed this as SVG, so ~250 KB of markup was stored and served
  // under image/svg+xml. A substring search for "<svg" would also pass it, because
  // the listing embeds inline glyphs; only the root element distinguishes the two.
  it('rejects an html directory listing that embeds inline svg glyphs', () => {
    expect(looksLikeSvg(IPFS_DIRECTORY_LISTING)).toBe(false)
  })

  it('rejects an ordinary html error page', () => {
    expect(looksLikeSvg(buf('<html><body><h1>404 Not Found</h1></body></html>'))).toBe(false)
  })

  it('rejects prose that merely contains angle brackets', () => {
    // Passed the old angle-bracket count; has no markup at all.
    expect(looksLikeSvg(buf('constraints: a < b < c < d'))).toBe(false)
  })

  it('rejects an element whose name merely starts with svg', () => {
    expect(looksLikeSvg(buf('<svgcatalog><entry/></svgcatalog>'))).toBe(false)
  })

  it('rejects empty content', () => {
    expect(looksLikeSvg(Buffer.alloc(0))).toBe(false)
  })
})

describe('detectImageExt', () => {
  const declaredSvg = buf('<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')

  it('identifies a raster image from its magic bytes', async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer()
    expect(await detectImageExt(png)).toBe('.png')
  })

  it('falls back to the svg sniff when magic bytes yield nothing', async () => {
    expect(await detectImageExt(buf('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('.svg')
  })

  it('rejects html so it is never stored as an image', async () => {
    expect(await detectImageExt(IPFS_DIRECTORY_LISTING)).toBeNull()
  })

  it('rejects unrecognized binary content', async () => {
    expect(await detectImageExt(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]))).toBeNull()
  })

  // The bytes parse as generic markup to file-type, which has no magic bytes of its own for vector images. The root
  // element decides, and the answer is always `.svg`.
  it('stores markup with an svg root as .svg', async () => {
    expect(await detectImageExt(declaredSvg)).toBe('.svg')
  })

  // Regression: this answered the source address's extension, so a markup document served from
  // https://host/x.html was stored as `.html` and sent back as text/html on this origin.
  it('refuses markup whose root is not svg, whatever its address says', async () => {
    const page = buf('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>hi</body></html>')
    expect(await detectImageExt(page)).toBeNull()
  })

  it('refuses a file type that is not a picture format', async () => {
    // A minimal PDF header: file-type names it `.pdf`.
    expect(await detectImageExt(buf('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\n'))).toBeNull()
  })
})

describe('servableExt', () => {
  it('keeps every picture extension', () => {
    for (const ext of SERVABLE_IMAGE_EXTS) expect(servableExt(ext)).toBe(ext)
  })

  it('turns an extension that is not a picture format into one served as plain bytes', () => {
    expect(servableExt('.html')).toBe('.bin')
    expect(servableExt('.xml')).toBe('.bin')
    expect(servableExt('')).toBe('.bin')
  })
})
