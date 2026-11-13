import sharp from 'sharp'
import type { FormatEnum } from 'sharp'

/**
 * Sanitize an image buffer before storage.
 *
 * Raster images (PNG, JPG, GIF, WebP, AVIF): Re-encode through sharp to strip
 * EXIF metadata, embedded scripts, and other potentially dangerous payloads.
 *
 * SVG images: Strip dangerous elements (script, foreignObject, use with external
 * refs), event handler attributes (on*), and javascript: URIs.
 */
export async function sanitizeImage(image: Buffer, ext: string): Promise<Buffer> {
  if (ext === '.svg') {
    return sanitizeSvg(image)
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

// ---------------------------------------------------------------------------
// SVG sanitization
// ---------------------------------------------------------------------------

/** Elements that can execute code or load external resources */
const DANGEROUS_ELEMENTS = [
  'script',
  'foreignObject',
  'iframe',
  'embed',
  'object',
  'applet',
  'math', // MathML can trigger XSS in some browsers
]

/** Build a regex that matches opening and closing tags + content for dangerous elements */
const DANGEROUS_ELEMENT_REGEX = new RegExp(
  DANGEROUS_ELEMENTS.map((el) => `<${el}[\\s>][\\s\\S]*?</${el}\\s*>`).join('|') +
    '|' +
    DANGEROUS_ELEMENTS.map((el) => `<${el}[\\s/][^>]*/>`).join('|'),
  'gi',
)

/** Matches event handler attributes: onclick, onload, onerror, etc. */
const EVENT_HANDLER_REGEX = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi

/**
 * Matches a link attribute (`href`, `src`, or `href` under any namespace prefix, since a document can
 * bind the xlink namespace to any prefix) with a quoted value. Group 1 is the name and the equals
 * sign, group 2 the opening quote, group 3 the value.
 */
const LINK_ATTRIBUTE_REGEX = /(\s+(?:[\w.-]+:)?(?:href|src)\s*=\s*)(["'])([^"']*)\2/gi

/** Named character references a browser decodes that can hide part of a scheme name. */
const NAMED_REFERENCES: Record<string, string> = { tab: '\t', newline: '\n', colon: ':', amp: '&' }

/** Matches a numeric (decimal or hex) or one of the named character references above. The semicolon is optional, as in a browser. */
const CHARACTER_REFERENCE_REGEX = /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));?/gi

/** Characters a browser ignores inside a scheme name, or in front of it. */
// eslint-disable-next-line no-control-regex
const IGNORED_URI_CHARACTERS = /[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g

/** Schemes that run code when a link is followed or an image is loaded. */
const SCRIPT_SCHEME_REGEX = /^(?:javascript|vbscript):/

/** How many times a value is decoded. A reference inside a reference (`&amp;#106;`) needs more than one pass. */
const MAX_DECODE_PASSES = 3

/** Decode numeric and the few named character references in `text`, once. Out-of-range numbers are left as written. */
function decodeCharacterReferencesOnce(text: string): string {
  return text.replace(CHARACTER_REFERENCE_REGEX, (whole, decimal, hex, name) => {
    if (name) return NAMED_REFERENCES[name.toLowerCase()] ?? whole
    const codePoint = decimal !== undefined ? parseInt(decimal, 10) : parseInt(hex, 16)
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : whole
  })
}

/** Decode character references until the text stops changing, at most `MAX_DECODE_PASSES` times. */
export function decodeCharacterReferences(text: string): string {
  let current = text
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    const next = decodeCharacterReferencesOnce(current)
    if (next === current) return current
    current = next
  }
  return current
}

/**
 * Whether a link value runs script. The value is read the way a browser reads it: character
 * references decoded, tabs, line breaks, other control characters and leading spaces ignored, case
 * folded. `&#106;avascript:` and `java&#x09;script:` are `javascript:` to a browser, and so they are here.
 */
export function isScriptUri(value: string): boolean {
  const normalized = decodeCharacterReferences(value).replace(IGNORED_URI_CHARACTERS, '').toLowerCase()
  return SCRIPT_SCHEME_REGEX.test(normalized)
}

/** Replace the value of every link attribute that runs script with `#`, keeping the quotes. */
function stripScriptLinks(svg: string): string {
  return svg.replace(LINK_ATTRIBUTE_REGEX, (whole, head, quote, value) =>
    isScriptUri(value) ? `${head}${quote}#${quote}` : whole,
  )
}

/** Matches <use> elements with external references (xlink:href="http://..." or href="http://...") */
const EXTERNAL_USE_REGEX = /<use\s[^>]*(?:xlink:)?href\s*=\s*(?:"|')https?:\/\/[^"']*(?:"|')[^>]*\/?>/gi

/** Matches data: URIs that aren't images (could be text/html, application/javascript, etc.) */
const DANGEROUS_DATA_URI_REGEX = /(\s+(?:href|xlink:href|src)\s*=\s*(?:"|'))data:(?!image\/)[^"']*(?:"|')/gi

/** Matches set/animate elements, whose target attribute is checked after decoding (see `targetsLink`) */
const ANIMATION_ELEMENT_REGEX = /<(?:set|animate)\s[^>]*>/gi

/** Matches a target attribute name that is a link attribute, in the text of an animation element */
const LINK_TARGET_REGEX = /attributeName\s*=\s*["']\s*(?:[\w.-]+:)?href\s*["']/i

/** Whether an animation element would rewrite a link attribute, which could inject a script URI. */
function targetsLink(element: string): boolean {
  return LINK_TARGET_REGEX.test(decodeCharacterReferences(element))
}

/** Matches CSS @import rules that can load external stylesheets */
const CSS_IMPORT_REGEX = /@import\s+(?:url\()?[^;)]+(?:\))?[^;]*;/gi

/** Matches file:// protocol URIs */
const FILE_PROTOCOL_REGEX = /(\s+(?:href|xlink:href|src)\s*=\s*(?:"|'))file:\/\/[^"']*(?:"|')/gi

function sanitizeSvg(image: Buffer): Buffer {
  let svg = image.toString('utf-8')

  // Strip dangerous elements and their content
  svg = svg.replace(DANGEROUS_ELEMENT_REGEX, '')

  // Strip event handler attributes
  svg = svg.replace(EVENT_HANDLER_REGEX, '')

  // Strip javascript: URIs, however their characters are written
  svg = stripScriptLinks(svg)

  // Strip file:// URIs
  svg = svg.replace(FILE_PROTOCOL_REGEX, '$1#')

  // Strip CSS @import (can load external stylesheets)
  svg = svg.replace(CSS_IMPORT_REGEX, '')

  // Strip <use> elements with external references
  svg = svg.replace(EXTERNAL_USE_REGEX, '')

  // Strip non-image data: URIs
  svg = svg.replace(DANGEROUS_DATA_URI_REGEX, '$1#')

  // Strip animate/set elements targeting href (can inject javascript:)
  svg = svg.replace(ANIMATION_ELEMENT_REGEX, (element) => (targetsLink(element) ? '' : element))

  return Buffer.from(svg, 'utf-8')
}
