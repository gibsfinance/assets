/**
 * @module oversized-png
 * A PNG whose header states a very large size while the file stays tiny. Tests use it to check that an image over
 * the pixel cap (`MAX_INPUT_PIXELS`) is refused when its header is read, before any pixel is decoded.
 */
import { crc32, deflateSync } from 'node:zlib'

/** One PNG chunk: length, type, data and the checksum of type and data. */
const pngChunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, checksum])
}

/**
 * A palette PNG that states a square size and carries almost no pixel data: 255 KB of real data would decode to
 * this size, and this fixture is a few hundred bytes. The size is read from the header, before any pixel is decoded.
 *
 * @param width Width the header states, in pixels.
 * @param height Height the header states, in pixels.
 */
export const palettePngOf = (width: number, height: number): Buffer => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 3 // palette colour
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('PLTE', Buffer.from([0, 0, 0])),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 0]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * A square palette PNG that states `side` by `side` pixels. See {@link palettePngOf}.
 *
 * @param side Width and height the header states, in pixels.
 */
export const palettePngClaiming = (side: number): Buffer => palettePngOf(side, side)
