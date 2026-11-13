import sharp from 'sharp'
import type { FormatEnum } from 'sharp'
import { sanitizeSvgDocument } from './svg-sanitize'

export { SvgRejectedError, decodeCharacterReferences, isScriptUri } from './svg-sanitize'

/**
 * Sanitize an image buffer before storage.
 *
 * Raster images (PNG, JPG, GIF, WebP, AVIF): Re-encode through sharp to strip
 * EXIF metadata, embedded scripts, and other potentially dangerous payloads.
 *
 * vector image images: Parse, remove everything unsafe and write the tree back (see `svg-sanitize.ts`).
 *
 * @throws {SvgRejectedError} For an vector image that is not well formed markup. Such a document is never stored as is.
 */
export async function sanitizeImage(image: Buffer, ext: string): Promise<Buffer> {
  if (ext === '.svg') {
    return sanitizeSvgDocument(image)
  }
  return sanitizeRaster(image, ext)
}

/** Re-encode a raster image through sharp to strip metadata and embedded payloads */
async function sanitizeRaster(image: Buffer, ext: string): Promise<Buffer> {
  // sharp's `toFormat` accepts `keyof FormatEnum | "avif"` — avif is typed
  // separately from the enum, so the union is required to include it.
  const formatMap: Record<string, keyof FormatEnum | 'avif'> = {
    '.png': 'png',
    '.jpg': 'jpeg',
    '.jpeg': 'jpeg',
    '.gif': 'gif',
    '.webp': 'webp',
    '.avif': 'avif',
    '.ico': 'png', // ICO → PNG re-encode
  }

  const format = formatMap[ext]
  if (!format) {
    // Unknown raster format — return as-is (will be detected by getExt)
    return image
  }

  try {
    return await sharp(image)
      .rotate() // Auto-rotate based on EXIF, then strip EXIF
      .toFormat(format)
      .toBuffer()
  } catch {
    // sharp can't process this image — return original
    // (e.g., corrupt file, animated GIF edge cases)
    return image
  }
}
