import sharp from 'sharp'
import type { FormatEnum } from 'sharp'
import { ImageRejectedError } from './image-rejected'
import { sanitizeSvgDocument } from './svg-sanitize'

export { SvgRejectedError, decodeCharacterReferences, isScriptUri } from './svg-sanitize'
export { ImageRejectedError } from './image-rejected'

/** The raster extensions that have a re-encoder, and the format each is written in. */
const RASTER_FORMATS: Readonly<Record<string, keyof FormatEnum | 'avif'>> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.gif': 'gif',
  '.webp': 'webp',
  '.avif': 'avif',
}

/**
 * Extensions whose files may hold several frames. They are read with `animated: true`, because
 * sharp otherwise reads only the first frame and the re-encoded file is a still.
 */
const ANIMATED_RASTER_EXTENSIONS: ReadonlySet<string> = new Set(['.gif', '.webp'])

/**
 * Sanitize an image buffer before storage.
 *
 * Raster images (PNG, JPEG, GIF, WebP, AVIF): re-encoded through sharp to strip metadata, embedded
 * scripts and any other payload. An animated GIF or WebP keeps its frames. A raster format with no
 * re-encoder (APNG, BMP, TIFF, ICO and the rest) is refused, because storing it would store the
 * bytes as they were downloaded; sharp cannot write an animated PNG, so an APNG cannot be cleaned
 * without losing its animation, and it is refused too.
 *
 * Vector images: parsed, everything unsafe removed and the tree written back (see `svg-sanitize.ts`).
 *
 * @throws {ImageRejectedError} For an image that cannot be made safe: a vector image that is not
 *   well formed markup (a `SvgRejectedError`), a raster format with no re-encoder, or a raster file
 *   sharp cannot decode. Such an image is never stored as it came.
 */
export async function sanitizeImage(image: Buffer, ext: string): Promise<Buffer> {
  if (ext === '.svg') {
    return sanitizeSvgDocument(image)
  }
  return sanitizeRaster(image, ext)
}

/** Re-encode a raster image through sharp to strip metadata and embedded payloads. */
async function sanitizeRaster(image: Buffer, ext: string): Promise<Buffer> {
  const format = RASTER_FORMATS[ext]
  if (!format) {
    throw new ImageRejectedError(`raster rejected: there is no re-encoder for ${ext}, so it cannot be cleaned`)
  }

  try {
    return await sharp(image, { animated: ANIMATED_RASTER_EXTENSIONS.has(ext) })
      .rotate() // Auto-rotate based on EXIF, then strip EXIF
      .toFormat(format)
      .toBuffer()
  } catch (error) {
    throw new ImageRejectedError(`raster rejected: sharp cannot decode this ${ext} file`, { cause: error })
  }
}
