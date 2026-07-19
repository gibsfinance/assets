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

/**
 * Identify an image's extension from its bytes, falling back to an SVG content
 * sniff. Returns null when the content is not a recognizable image, which callers
 * treat as a rejection.
 *
 * `providedExt` is the extension from the source URI. It is consulted only to
 * disambiguate a `file-type` result of `.xml`, which is what SVG-adjacent markup
 * reports when it does parse as XML.
 */
export const detectImageExt = async (image: Buffer, providedExt: string): Promise<string | null> => {
  const detected = await fileType.fileTypeFromBuffer(Uint8Array.from(image))
  const ext = detected && detected.ext ? `.${detected.ext}` : null
  if (ext) {
    if (ext === '.xml' && providedExt !== ext) {
      return providedExt
    }
    return ext
  }
  return looksLikeSvg(image) ? '.svg' : null
}
