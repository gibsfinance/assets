/**
 * @module svg-raster-embed
 * Byte-level reading of a raster picture embedded in a vector image: which format its bytes are, how many pixels
 * wide and high its header states, and whether its base64 text is well formed.
 *
 * Everything here is a pure function of the bytes it is given. The module imports nothing, so the sanitizer worker
 * loads it without anything else. It never decodes a picture: sizes come from the header, and a header that is short,
 * or that does not match its format, gives no answer rather than a guess.
 */

/** The raster formats a vector image may embed and keep. */
export type EmbeddedRasterFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'avif'

/** The media type each kept format is labelled with in a data address. */
export const EMBEDDED_RASTER_MEDIA_TYPES: Readonly<Record<EmbeddedRasterFormat, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
}

/** A picture's size as its header states it, in pixels. */
export interface RasterDimensions {
  readonly width: number
  readonly height: number
}

/** The eight bytes that open every PNG file. */
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')

/** The byte count a PNG header needs: the signature, the IHDR chunk's length and type, then its width and height. */
const PNG_HEADER_LENGTH = 24

/** The JPEG start-of-image marker, and the first byte of every marker. */
const JPEG_START_OF_IMAGE = 0xd8
const JPEG_MARKER_PREFIX = 0xff

/** JPEG markers that stand alone, with no length field: restart markers, temporary use, and start/end of image. */
const isStandaloneJpegMarker = (marker: number): boolean =>
  marker === JPEG_START_OF_IMAGE || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)

/** The JPEG markers that open a frame whose header states the size: baseline, extended and progressive Huffman coding. */
const JPEG_FRAME_MARKERS: ReadonlySet<number> = new Set([0xc0, 0xc1, 0xc2])

/** The JPEG markers that end the header part of the file: end of image, and start of scan. */
const JPEG_END_OF_HEADER_MARKERS: ReadonlySet<number> = new Set([0xd9, 0xda])

/** The byte offset of the first chunk of a WebP file's image data. */
const WEBP_CHUNK_DATA = 20

/** The start code a lossy WebP frame carries before its width and height. */
const WEBP_LOSSY_START_CODE = Buffer.from([0x9d, 0x01, 0x2a])

/** Whether the bytes begin with the given ASCII text at the given offset. */
const hasTextAt = (bytes: Buffer, offset: number, text: string): boolean =>
  bytes.length >= offset + text.length && bytes.toString('latin1', offset, offset + text.length) === text

/** Which format the bytes are, by their magic numbers, or null when none of the kept formats matches. */
export function sniffRasterFormat(bytes: Buffer): EmbeddedRasterFormat | null {
  if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'png'
  if (bytes[0] === JPEG_MARKER_PREFIX && bytes[1] === JPEG_START_OF_IMAGE && bytes[2] === JPEG_MARKER_PREFIX)
    return 'jpeg'
  if (hasTextAt(bytes, 0, 'GIF87a') || hasTextAt(bytes, 0, 'GIF89a')) return 'gif'
  if (hasTextAt(bytes, 0, 'RIFF') && hasTextAt(bytes, 8, 'WEBP')) return 'webp'
  if (hasTextAt(bytes, 4, 'ftyp') && (hasTextAt(bytes, 8, 'avif') || hasTextAt(bytes, 8, 'avis'))) return 'avif'
  return null
}

/** The width and height of a picture, when both are at least one pixel. Null otherwise. */
const positiveDimensions = (width: number, height: number): RasterDimensions | null =>
  width > 0 && height > 0 ? { width, height } : null

/** The size a PNG header states: the IHDR chunk's width and height. */
function pngDimensions(bytes: Buffer): RasterDimensions | null {
  if (bytes.length < PNG_HEADER_LENGTH || !hasTextAt(bytes, 12, 'IHDR')) return null
  return positiveDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
}

/** The size a GIF header states: the logical screen width and height, which are little-endian sixteen-bit numbers. */
function gifDimensions(bytes: Buffer): RasterDimensions | null {
  if (bytes.length < 10) return null
  return positiveDimensions(bytes.readUInt16LE(6), bytes.readUInt16LE(8))
}

/** The index of the marker byte that follows a marker's fill bytes (a run of 0xff), or the length of the bytes when none follows. */
function markerIndexAfterFill(bytes: Buffer, prefixIndex: number): number {
  let index = prefixIndex
  while (index < bytes.length && bytes[index] === JPEG_MARKER_PREFIX) index += 1
  return index
}

/**
 * The size a JPEG header states, from the first frame header found before the scan. Each segment is skipped by
 * its length field. Every read is checked against the end of the bytes, so a file that stops early gives null.
 */
function jpegDimensions(bytes: Buffer): RasterDimensions | null {
  let offset = 2
  while (offset + 2 < bytes.length) {
    if (bytes[offset] !== JPEG_MARKER_PREFIX) return null
    const markerIndex = markerIndexAfterFill(bytes, offset + 1)
    if (markerIndex >= bytes.length) return null
    const marker = bytes[markerIndex]
    if (isStandaloneJpegMarker(marker)) {
      offset = markerIndex + 1
    } else if (JPEG_END_OF_HEADER_MARKERS.has(marker)) {
      return null
    } else if (JPEG_FRAME_MARKERS.has(marker)) {
      if (markerIndex + 8 > bytes.length) return null
      return positiveDimensions(bytes.readUInt16BE(markerIndex + 6), bytes.readUInt16BE(markerIndex + 4))
    } else {
      if (markerIndex + 3 > bytes.length) return null
      offset = markerIndex + 1 + bytes.readUInt16BE(markerIndex + 1)
    }
  }
  return null
}

/** The size a lossy WebP frame states (`VP8 `): fourteen bits of width and of height after the start code. */
function webpLossyDimensions(bytes: Buffer): RasterDimensions | null {
  const startCode = WEBP_CHUNK_DATA + 3
  if (bytes.length < startCode + 7) return null
  if (!bytes.subarray(startCode, startCode + 3).equals(WEBP_LOSSY_START_CODE)) return null
  return positiveDimensions(bytes.readUInt16LE(startCode + 3) & 0x3fff, bytes.readUInt16LE(startCode + 5) & 0x3fff)
}

/** The size a lossless WebP frame states (`VP8L`): fourteen bits each of width minus one and height minus one. */
function webpLosslessDimensions(bytes: Buffer): RasterDimensions | null {
  const signature = WEBP_CHUNK_DATA
  if (bytes.length < signature + 5 || bytes[signature] !== 0x2f) return null
  const packed = bytes.readUInt32LE(signature + 1)
  return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 }
}

/** The size an extended WebP header states (`VP8X`): a canvas width and height, each minus one, in three bytes. */
function webpExtendedDimensions(bytes: Buffer): RasterDimensions | null {
  if (bytes.length < WEBP_CHUNK_DATA + 10) return null
  return {
    width: bytes.readUIntLE(WEBP_CHUNK_DATA + 4, 3) + 1,
    height: bytes.readUIntLE(WEBP_CHUNK_DATA + 7, 3) + 1,
  }
}

/** The size a WebP file states, read from whichever of its three chunk kinds comes first. */
function webpDimensions(bytes: Buffer): RasterDimensions | null {
  if (bytes.length < WEBP_CHUNK_DATA) return null
  if (hasTextAt(bytes, 12, 'VP8 ')) return webpLossyDimensions(bytes)
  if (hasTextAt(bytes, 12, 'VP8L')) return webpLosslessDimensions(bytes)
  if (hasTextAt(bytes, 12, 'VP8X')) return webpExtendedDimensions(bytes)
  return null
}

/**
 * The pixel size a picture's header states, or null when the header cannot be read or states no pixels.
 *
 * AVIF always gives null. Its size sits in an item property box that has to be matched to the picture the file
 * shows first, which needs the file's item tables; a size taken from the wrong box would be a wrong budget. So an
 * AVIF embed is refused rather than measured.
 *
 * @param bytes The picture bytes. A header that is truncated gives null.
 * @param format The format the bytes were sniffed as.
 */
export function readRasterDimensions(bytes: Buffer, format: EmbeddedRasterFormat): RasterDimensions | null {
  if (format === 'png') return pngDimensions(bytes)
  if (format === 'gif') return gifDimensions(bytes)
  if (format === 'jpeg') return jpegDimensions(bytes)
  if (format === 'webp') return webpDimensions(bytes)
  return null
}

/** Base64 text as a browser reads it: ASCII whitespace ignored, the standard alphabet, padding, and a whole number of groups. */
const STRICT_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** Characters a browser ignores inside base64 text. */
const BASE64_WHITESPACE = /[\t\n\f\r ]/g

/** The decoded bytes of base64 text, and the same text with its whitespace removed, or null when the text is not base64. */
export interface Base64Payload {
  readonly text: string
  readonly bytes: Buffer
}

/**
 * Decode base64 text strictly. Node's decoder accepts some text that a browser refuses, so the check runs first.
 *
 * @param payload The text after the comma of a data address.
 */
export function readBase64Payload(payload: string): Base64Payload | null {
  const text = payload.replace(BASE64_WHITESPACE, '')
  if (text.length % 4 !== 0 || !STRICT_BASE64.test(text)) return null
  return { text, bytes: Buffer.from(text, 'base64') }
}
