import sharp from 'sharp'

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
  const formatMap: Record<string, keyof sharp.FormatEnum> = {
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

/** Matches javascript: URIs in href/xlink:href/src attributes */
const JAVASCRIPT_URI_REGEX = /(\s+(?:href|xlink:href|src)\s*=\s*(?:"|'))javascript:[^"']*(?:"|')/gi

/** Matches <use> elements with external references (xlink:href="http://..." or href="http://...") */
const EXTERNAL_USE_REGEX = /<use\s[^>]*(?:xlink:)?href\s*=\s*(?:"|')https?:\/\/[^"']*(?:"|')[^>]*\/?>/gi

/** Matches data: URIs that aren't images (could be text/html, application/javascript, etc.) */
const DANGEROUS_DATA_URI_REGEX = /(\s+(?:href|xlink:href|src)\s*=\s*(?:"|'))data:(?!image\/)[^"']*(?:"|')/gi

/** Matches set/animate elements that can modify href to javascript: */
const DANGEROUS_ANIMATE_REGEX =
  /<(?:set|animate)\s[^>]*(?:attributeName\s*=\s*(?:"|')(?:href|xlink:href)(?:"|'))[^>]*>/gi

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

  // Strip javascript: URIs
  svg = svg.replace(JAVASCRIPT_URI_REGEX, '$1#')

  // Strip file:// URIs
  svg = svg.replace(FILE_PROTOCOL_REGEX, '$1#')

  // Strip CSS @import (can load external stylesheets)
  svg = svg.replace(CSS_IMPORT_REGEX, '')

  // Strip <use> elements with external references
  svg = svg.replace(EXTERNAL_USE_REGEX, '')

  // Strip non-image data: URIs
  svg = svg.replace(DANGEROUS_DATA_URI_REGEX, '$1#')

  // Strip animate/set elements targeting href (can inject javascript:)
  svg = svg.replace(DANGEROUS_ANIMATE_REGEX, '')

  return Buffer.from(svg, 'utf-8')
}
