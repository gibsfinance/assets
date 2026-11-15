/**
 * @module image-format
 * Format detection for images arriving from collectors and user submissions.
 *
 * Raster formats carry magic bytes and are identified by `file-type`. SVG does not
 * — it is plain text — so it has to be sniffed from content, and that sniff is the
 * only thing standing between the image store and any text file on the internet.
 */
import * as fileType from 'file-type'

/**
 * Leading bytes inspected when sniffing for an SVG root element. Generous enough
 * for an XML declaration, a doctype, and a license comment header, which is the
 * usual preamble on registry-published logos.
 */
const SVG_SNIFF_BYTES = 1024

/** XML declaration, doctype, or comment — anything legal before the root element. */
const SVG_PREAMBLE_REGEX = /^\s*(?:<\?xml[^>]*\?>|<!DOCTYPE[^>[]*(?:\[[^\]]*\])?[^>]*>|<!--[\s\S]*?-->)\s*/i

/** Root element is `<svg`, followed by a delimiter rather than more element name. */
const SVG_ROOT_REGEX = /^<svg[\s/>]/i

/**
 * Whether the buffer's *root element* is `<svg>`.
 *
 * Matching the root element — rather than searching for "<svg" anywhere in the
 * content — is what separates a real SVG from an HTML page that merely embeds
 * inline icons. IPFS gateway directory listings are the case that motivated this:
 * they are HTML, they contain inline `<svg>` glyphs, and a substring search calls
 * them images. So does counting angle brackets, which is what this replaced.
 */
export const looksLikeSvg = (image: Buffer): boolean => {
  // Strip a UTF-8 byte-order mark, then any legal preamble, repeatedly — a file
  // may carry a declaration, then a doctype, then several comments.
  let head = image.toString('utf8', 0, Math.min(image.length, SVG_SNIFF_BYTES)).replace(/^\uFEFF/, '')
  let stripped = head.replace(SVG_PREAMBLE_REGEX, '')
  while (stripped !== head) {
    head = stripped
    stripped = head.replace(SVG_PREAMBLE_REGEX, '')
  }
  return SVG_ROOT_REGEX.test(head.trimStart())
}

/** An older spelling of `.svg` that some stored rows carry. Served and sanitized as `.svg`. */
export const LEGACY_VECTOR_EXT = '.svg+xml'

/**
 * The extensions an image may be stored and served under. Every one is a picture format. The read
 * path hands a stored extension to Express to choose the `content-type`, so an extension outside
 * this list (`.html`, `.xml`, `.pdf`) would let stored bytes be served as a document on this origin.
 */
export const SERVABLE_IMAGE_EXTS: ReadonlySet<string> = new Set([
  '.png',
  '.apng',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.ico',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
  '.jxl',
  '.svg',
  LEGACY_VECTOR_EXT,
])

/**
 * The extension to give Express when it sets the `content-type` of a stored image: the stored one
 * when it is a picture format, else `.bin`, which Express answers as `application/octet-stream`.
 * A row stored before the allow-list existed may carry any extension, so the read path checks too.
 */
export const servableExt = (ext: string): string => {
  // Express has no media type for `.svg+xml`, so it would answer octet-stream and a browser would
  // not draw the image. It is the same format as `.svg`.
  if (ext === LEGACY_VECTOR_EXT) return '.svg'
  return SERVABLE_IMAGE_EXTS.has(ext) ? ext : '.bin'
}

/**
 * Identify an image's extension from its bytes, falling back to an SVG content
 * sniff. Returns null when the content is not a recognizable image, which callers
 * treat as a rejection.
 *
 * The bytes alone decide. A source address names its file however it likes, and an earlier version
 * trusted it when the bytes parsed as generic markup: a document at `https://host/x.html` was stored
 * as `.html` and served as a page. Markup is now stored only when its root element is `<svg>`, as
 * `.svg`; any other markup is refused. A type that is not a picture format is refused too.
 */
export const detectImageExt = async (image: Buffer): Promise<string | null> => {
  const detected = await fileType.fileTypeFromBuffer(Uint8Array.from(image))
  const ext = detected && detected.ext ? `.${detected.ext}` : null
  if (ext === '.xml') return looksLikeSvg(image) ? '.svg' : null
  if (ext) return SERVABLE_IMAGE_EXTS.has(ext) ? ext : null
  return looksLikeSvg(image) ? '.svg' : null
}
