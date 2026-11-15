import { beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { readBase64Payload, readRasterDimensions, sniffRasterFormat } from './svg-raster-embed'

/** A solid picture of the given size in the given format, generated here so no logo file is committed. */
const picture = (width: number, height: number, channels: 3 | 4 = 3) =>
  sharp({ create: { width, height, channels, background: { r: 200, g: 40, b: 40, alpha: 1 } } })

/** The four-character chunk name at the given offset of a WebP file. */
const webpChunkName = (bytes: Buffer): string => bytes.toString('latin1', 12, 16)

/** A JPEG with a single frame header, written by hand: SOI, optional segments, then the frame header. */
const handJpeg = (segments: Buffer[], frame: Buffer): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, frame])

/** A baseline frame header that states 48 wide and 64 high (the marker is given in the caller). */
const frameHeader = (marker: number): Buffer =>
  Buffer.from([0xff, marker, 0x00, 0x0b, 0x08, 0x00, 0x40, 0x00, 0x30, 0x01, 0x01, 0x11, 0x00])

/** A PNG-shaped buffer: the signature, then the given bytes after it. */
const pngBytes = (rest: Buffer): Buffer => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), rest])

/** The IHDR chunk header (length, name) followed by a width and a height. */
const ihdr = (width: number, height: number): Buffer => {
  const body = Buffer.alloc(8)
  body.writeUInt32BE(width, 0)
  body.writeUInt32BE(height, 4)
  return Buffer.concat([Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR', 'latin1'), body])
}

/** A GIF logical screen descriptor: the signature, then little-endian width and height. */
const gifBytes = (signature: string, width: number, height: number, length = 10): Buffer => {
  const bytes = Buffer.alloc(length)
  bytes.write(signature, 0, 'latin1')
  bytes.writeUInt16LE(width, 6)
  bytes.writeUInt16LE(height, 8)
  return bytes
}

describe('sniffRasterFormat', () => {
  let png: Buffer
  let jpeg: Buffer
  let progressiveJpeg: Buffer
  let gif: Buffer
  let webp: Buffer
  let avif: Buffer

  beforeAll(async () => {
    png = await picture(8, 8).png().toBuffer()
    jpeg = await picture(8, 8).jpeg().toBuffer()
    progressiveJpeg = await picture(8, 8).jpeg({ progressive: true }).toBuffer()
    gif = await picture(8, 8).gif().toBuffer()
    webp = await picture(8, 8).webp().toBuffer()
    avif = await picture(8, 8).avif().toBuffer()
  }, 60_000)

  it('recognises each kept format from its own bytes', () => {
    expect(sniffRasterFormat(png)).toBe('png')
    expect(sniffRasterFormat(jpeg)).toBe('jpeg')
    expect(sniffRasterFormat(progressiveJpeg)).toBe('jpeg')
    expect(sniffRasterFormat(gif)).toBe('gif')
    expect(sniffRasterFormat(webp)).toBe('webp')
    expect(sniffRasterFormat(avif)).toBe('avif')
  })

  it('recognises both GIF versions', () => {
    expect(sniffRasterFormat(gifBytes('GIF87a', 1, 1))).toBe('gif')
    expect(sniffRasterFormat(gifBytes('GIF89a', 1, 1))).toBe('gif')
  })

  it('recognises AVIF under either brand', () => {
    const avifBrand = (brand: string) =>
      Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp', 'latin1'), Buffer.from(brand, 'latin1')])
    expect(sniffRasterFormat(avifBrand('avif'))).toBe('avif')
    expect(sniffRasterFormat(avifBrand('avis'))).toBe('avif')
  })

  it('does not take a HEIC or other ISO box for AVIF', () => {
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftyp', 'latin1'),
      Buffer.from('heic', 'latin1'),
    ])
    expect(sniffRasterFormat(heic)).toBeNull()
  })

  it('does not take a RIFF file that is not WebP for WebP', () => {
    const wav = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WAVE', 'latin1')])
    expect(sniffRasterFormat(wav)).toBeNull()
  })

  it('answers null for bytes that match no kept format, including empty and very short input', () => {
    expect(sniffRasterFormat(Buffer.alloc(0))).toBeNull()
    expect(sniffRasterFormat(Buffer.from('plain text, not an image'))).toBeNull()
    expect(sniffRasterFormat(Buffer.from([0xff, 0xd8]))).toBeNull()
    expect(sniffRasterFormat(Buffer.from([0xff, 0xd8, 0x00]))).toBeNull()
    expect(sniffRasterFormat(Buffer.from('BM' + '\0'.repeat(20), 'latin1'))).toBeNull()
  })

  it('answers null for a short prefix of a signature rather than reading past the end', () => {
    expect(sniffRasterFormat(Buffer.from('89504e47', 'hex'))).toBeNull()
    expect(sniffRasterFormat(Buffer.from('GIF8', 'latin1'))).toBeNull()
    expect(sniffRasterFormat(Buffer.from('RIFF', 'latin1'))).toBeNull()
  })
})

describe('readRasterDimensions for PNG', () => {
  it('reads the width and height from the IHDR chunk', () => {
    expect(readRasterDimensions(pngBytes(ihdr(300, 120)), 'png')).toEqual({ width: 300, height: 120 })
  })

  it('reads a real PNG', async () => {
    expect(readRasterDimensions(await picture(33, 17).png().toBuffer(), 'png')).toEqual({ width: 33, height: 17 })
  })

  it('answers null when the chunk after the signature is not IHDR', () => {
    const wrongChunk = Buffer.concat([Buffer.from([0, 0, 0, 13]), Buffer.from('PLTE', 'latin1'), Buffer.alloc(8)])
    expect(readRasterDimensions(pngBytes(wrongChunk), 'png')).toBeNull()
  })

  it('answers null for a header that stops before the width and height', () => {
    expect(readRasterDimensions(pngBytes(Buffer.from([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])), 'png')).toBeNull()
  })

  it('answers null for a zero width or height', () => {
    expect(readRasterDimensions(pngBytes(ihdr(0, 10)), 'png')).toBeNull()
    expect(readRasterDimensions(pngBytes(ihdr(10, 0)), 'png')).toBeNull()
  })
})

describe('readRasterDimensions for GIF', () => {
  it('reads the logical screen width and height, little-endian', () => {
    expect(readRasterDimensions(gifBytes('GIF89a', 258, 7), 'gif')).toEqual({ width: 258, height: 7 })
  })

  it('reads a real GIF', async () => {
    expect(readRasterDimensions(await picture(20, 9).gif().toBuffer(), 'gif')).toEqual({ width: 20, height: 9 })
  })

  it('answers null for a header shorter than the logical screen descriptor', () => {
    expect(readRasterDimensions(Buffer.from('GIF89a\x05\x00\x05', 'latin1'), 'gif')).toBeNull()
  })

  it('answers null for a zero width or height', () => {
    expect(readRasterDimensions(gifBytes('GIF89a', 0, 5), 'gif')).toBeNull()
    expect(readRasterDimensions(gifBytes('GIF89a', 5, 0), 'gif')).toBeNull()
  })
})

describe('readRasterDimensions for JPEG', () => {
  let baseline: Buffer
  let progressive: Buffer

  beforeAll(async () => {
    baseline = await picture(48, 64).jpeg().toBuffer()
    progressive = await picture(48, 64).jpeg({ progressive: true }).toBuffer()
  }, 60_000)

  it('reads a baseline frame (SOF0)', () => {
    expect(readRasterDimensions(baseline, 'jpeg')).toEqual({ width: 48, height: 64 })
  })

  it('reads a progressive frame (SOF2)', () => {
    expect(readRasterDimensions(progressive, 'jpeg')).toEqual({ width: 48, height: 64 })
  })

  it('reads an extended sequential frame (SOF1), from a baseline file whose frame marker is relabelled', () => {
    const extended = Buffer.from(baseline)
    extended[extended.indexOf(Buffer.from([0xff, 0xc0])) + 1] = 0xc1
    expect(readRasterDimensions(extended, 'jpeg')).toEqual({ width: 48, height: 64 })
  })

  it('skips a segment by its length before the frame header', () => {
    const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00])
    expect(readRasterDimensions(handJpeg([app0], frameHeader(0xc0)), 'jpeg')).toEqual({ width: 48, height: 64 })
  })

  it('skips fill bytes in front of a marker', () => {
    const filled = Buffer.from([0xff, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x40, 0x00, 0x30, 0x01, 0x01, 0x11, 0x00])
    expect(readRasterDimensions(handJpeg([], filled), 'jpeg')).toEqual({ width: 48, height: 64 })
  })

  it('skips a standalone marker (a restart marker has no length field)', () => {
    const restart = Buffer.from([0xff, 0xd0])
    expect(readRasterDimensions(handJpeg([restart], frameHeader(0xc0)), 'jpeg')).toEqual({ width: 48, height: 64 })
  })

  it('answers null when a fill-byte run reaches the end of the file', () => {
    expect(readRasterDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xff, 0xff]), 'jpeg')).toBeNull()
  })

  it('answers null when a byte where a marker should be is not 0xff', () => {
    expect(readRasterDimensions(Buffer.from([0xff, 0xd8, 0x00, 0x00, 0x00, 0x00]), 'jpeg')).toBeNull()
  })

  it('answers null when the scan starts or the file ends before a frame header', () => {
    expect(readRasterDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x00, 0x00]), 'jpeg')).toBeNull()
    expect(readRasterDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x00]), 'jpeg')).toBeNull()
    expect(readRasterDimensions(Buffer.from([0xff, 0xd8]), 'jpeg')).toBeNull()
  })

  it('answers null when a segment length is cut off before it is read', () => {
    expect(readRasterDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), 'jpeg')).toBeNull()
  })

  it('answers null when a frame header is cut off before its width', () => {
    expect(readRasterDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x40]), 'jpeg')).toBeNull()
  })

  it('answers null when a frame header states a zero size', () => {
    expect(
      readRasterDimensions(
        handJpeg([], Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x00, 0x00, 0x30, 0x01, 0x01, 0x11, 0x00])),
        'jpeg',
      ),
    ).toBeNull()
  })
})

/**
 * An extended WebP file (VP8X) that states a canvas of the given size and carries no picture data. sharp writes a
 * plain VP8 file for a lossy picture with alpha, so the extended container is written here by hand.
 */
const extendedWebpCanvas = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(30)
  bytes.write('RIFF', 0, 'latin1')
  bytes.writeUInt32LE(22, 4)
  bytes.write('WEBP', 8, 'latin1')
  bytes.write('VP8X', 12, 'latin1')
  bytes.writeUInt32LE(10, 16)
  bytes.writeUIntLE(width - 1, 24, 3)
  bytes.writeUIntLE(height - 1, 27, 3)
  return bytes
}

describe('readRasterDimensions for WebP', () => {
  let lossy: Buffer
  let lossless: Buffer
  const extended = extendedWebpCanvas(37, 19)

  beforeAll(async () => {
    lossy = await picture(37, 19).webp().toBuffer()
    lossless = await picture(37, 19).webp({ lossless: true }).toBuffer()
  }, 60_000)

  it('reads a lossy frame, whose chunk is VP8', () => {
    expect(webpChunkName(lossy)).toBe('VP8 ')
    expect(readRasterDimensions(lossy, 'webp')).toEqual({ width: 37, height: 19 })
  })

  it('reads a lossless frame, whose chunk is VP8L', () => {
    expect(webpChunkName(lossless)).toBe('VP8L')
    expect(readRasterDimensions(lossless, 'webp')).toEqual({ width: 37, height: 19 })
  })

  it('reads an extended frame, whose chunk is VP8X (lossy with alpha)', () => {
    expect(webpChunkName(extended)).toBe('VP8X')
    expect(readRasterDimensions(extended, 'webp')).toEqual({ width: 37, height: 19 })
  })

  it('answers null for a chunk that is none of the three kinds', () => {
    const unknown = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.alloc(4),
      Buffer.from('WEBPXXXX', 'latin1'),
      Buffer.alloc(20),
    ])
    expect(readRasterDimensions(unknown, 'webp')).toBeNull()
  })

  it('answers null for a file that stops before its first chunk', () => {
    expect(readRasterDimensions(Buffer.from('RIFF\0\0\0\0WEBP', 'latin1'), 'webp')).toBeNull()
  })

  it('answers null for a lossy chunk without the frame start code', () => {
    const wrongStart = Buffer.from(lossy)
    wrongStart[23] = 0x00
    expect(readRasterDimensions(wrongStart, 'webp')).toBeNull()
  })

  it('answers null for a lossy chunk cut off before its size', () => {
    expect(readRasterDimensions(lossy.subarray(0, 26), 'webp')).toBeNull()
  })

  it('answers null for a lossless chunk without its signature byte', () => {
    const wrongSignature = Buffer.from(lossless)
    wrongSignature[20] = 0x00
    expect(readRasterDimensions(wrongSignature, 'webp')).toBeNull()
  })

  it('answers null for a lossless chunk cut off before its size', () => {
    expect(readRasterDimensions(lossless.subarray(0, 22), 'webp')).toBeNull()
  })

  it('answers null for an extended chunk cut off before its canvas size', () => {
    expect(readRasterDimensions(extended.subarray(0, 26), 'webp')).toBeNull()
  })
})

describe('readRasterDimensions for AVIF', () => {
  it('always answers null, because its size is not read from the file header', async () => {
    expect(readRasterDimensions(await picture(16, 16).avif().toBuffer(), 'avif')).toBeNull()
  })
})

describe('readBase64Payload', () => {
  it('decodes standard base64', () => {
    const payload = readBase64Payload('aGVsbG8=')
    expect(payload?.text).toBe('aGVsbG8=')
    expect(payload?.bytes.toString('utf8')).toBe('hello')
  })

  it('removes ASCII whitespace before checking, as a browser does', () => {
    const payload = readBase64Payload('aGVs\nbG8=\t ')
    expect(payload?.text).toBe('aGVsbG8=')
    expect(payload?.bytes.toString('utf8')).toBe('hello')
  })

  it('accepts an empty payload, which decodes to no bytes', () => {
    expect(readBase64Payload('')?.bytes.length).toBe(0)
  })

  it('refuses a character outside the standard alphabet', () => {
    expect(readBase64Payload('aGVs-G8=')).toBeNull()
    expect(readBase64Payload('aGVs%2BG8=')).toBeNull()
  })

  it('refuses a length that is not a whole number of four-character groups', () => {
    expect(readBase64Payload('aGVsb')).toBeNull()
  })

  it('refuses padding in the middle of the text', () => {
    expect(readBase64Payload('aG=sbG8=')).toBeNull()
  })

  it('refuses more than two padding characters', () => {
    expect(readBase64Payload('aGVs===')).toBeNull()
  })
})
