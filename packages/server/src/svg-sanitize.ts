/**
 * @module svg-sanitize
 * Parser-based vector image sanitizer.
 *
 * The document is read by a real markup parser, walked as a tree, and written back out. Nothing here
 * matches markup with a regular expression, so an attribute value that looks like markup (a fake
 * `src="` inside another attribute) cannot hide a real attribute from the checks.
 *
 * What the walk keeps and removes:
 * - Elements: only a fixed list of vector image elements in the vector image namespace stays. Everything else
 *   (script, foreignObject, web page markup, math markup, editor metadata, handler and listener elements) goes with
 *   its children.
 * - Attributes: every attribute whose name starts with `on` goes. A link (`href` or `src`, under
 *   any prefix) that runs script, reads a file, or holds a data address that is not an image is
 *   replaced by `#`. A `use` with a link that is not local is removed.
 * - Animation: an animation element that targets a link or an `on*` attribute is removed.
 * - Styles: `@import` rules and `url()` values that are not local or `data:image` are removed from
 *   style elements and from every attribute.
 * - Document: comments, processing instructions and the document type (with its entity
 *   declarations) are removed. The parser never expands an entity, so a document that uses one is
 *   rejected as unreadable instead of expanded.
 *
 * A document the parser cannot read is rejected with {@link SvgRejectedError}; it is never stored as is.
 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

/** The vector image namespace. An element outside it is removed. */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/** The element name the document has to start with. */
const ROOT_ELEMENT = 'svg'

/** DOM node type numbers. */
const ELEMENT_NODE = 1
const TEXT_NODE = 3
const CDATA_SECTION_NODE = 4

/** Elements the walk keeps. Anything else in an vector image document is removed. */
const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  // structure
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'switch',
  'a',
  'view',
  'title',
  'desc',
  'metadata',
  'style',
  // shapes and text
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'image',
  // painting
  'linearGradient',
  'radialGradient',
  'meshgradient',
  'stop',
  'pattern',
  'clipPath',
  'mask',
  'marker',
  // filters
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feImage',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
  // animation (checked again by `targetsLinkOrHandler`)
  'animate',
  'animateTransform',
  'animateMotion',
  'set',
  'mpath',
  // old font elements some exported files still carry
  'font',
  'font-face',
  'glyph',
  'missing-glyph',
  'hkern',
  'vkern',
])

/** Animation elements, which can rewrite another attribute and so are looked at twice. */
const ANIMATION_ELEMENTS: ReadonlySet<string> = new Set(['animate', 'animateTransform', 'animateMotion', 'set'])

/** Why an vector image could not be made safe to store. */
export class SvgRejectedError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`svg rejected: ${reason}`, options)
    this.name = 'SvgRejectedError'
  }
}

// ---------------------------------------------------------------------------
// Link values
// ---------------------------------------------------------------------------

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

/**
 * Decode character references until the text stops changing, at most `MAX_DECODE_PASSES` times.
 *
 * The markup parser has already decoded each attribute value once. This second reading is on purpose:
 * a value that is still a reference after the parser (`&amp;#106;` became `&#106;`) is read as a
 * script link if any consumer decodes it again, such as a page that inlines the file as web page markup.
 * It can only make a link look more like a script link, never less, so it errs toward removal.
 */
export function decodeCharacterReferences(text: string): string {
  let current = text
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    const next = decodeCharacterReferencesOnce(current)
    if (next === current) return current
    current = next
  }
  return current
}

/** A link value as a browser reads it: references decoded, ignored characters removed, case folded. */
function normalizeLink(value: string): string {
  return decodeCharacterReferences(value).replace(IGNORED_URI_CHARACTERS, '').toLowerCase()
}

/**
 * Whether a link value runs script. The value is read the way a browser reads it: character
 * references decoded, tabs, line breaks, other control characters and leading spaces ignored, case
 * folded. `&#106;avascript:` and `java&#x09;script:` are `javascript:` to a browser, and so they are here.
 */
export function isScriptUri(value: string): boolean {
  return SCRIPT_SCHEME_REGEX.test(normalizeLink(value))
}

/** Whether a link value cannot be kept: it runs script, reads a file, or holds data that is not an image. */
function isUnsafeLink(value: string): boolean {
  const normalized = normalizeLink(value)
  if (SCRIPT_SCHEME_REGEX.test(normalized)) return true
  if (normalized.startsWith('file:')) return true
  return normalized.startsWith('data:') && !normalized.startsWith('data:image/')
}

/** Whether a link value points inside the document. */
function isLocalLink(value: string): boolean {
  return normalizeLink(value).startsWith('#')
}

/** The replacement for a link that cannot be kept. */
const NEUTRAL_LINK = '#'

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** Matches a style sheet `@import` rule up to its semicolon, or to the end of the text when it has none. */
const CSS_IMPORT_REGEX = /@import\b[^;]*(?:;|$)/gi

/** Matches a style sheet `url()` value, quoted or not. Group 1 is what is inside the parentheses. */
const CSS_URL_REGEX = /url\(\s*((?:"[^"]*"|'[^']*'|[^)]*))\s*\)/gi

/** Matches constructs older browsers run script through. */
const CSS_SCRIPT_CONSTRUCT_REGEX = /expression\s*\(|-moz-binding|behavior\s*:/gi

/** Matches a style sheet escape: a backslash and one to six hex digits (and one space), or a backslash and any character. */
const CSS_ESCAPE_REGEX = /\\(?:([0-9a-f]{1,6})[ \t\n\r\f]?|([^\n\r\f]))/gi

/** Read the style sheet escapes in `text`, so `\6a avascript:` becomes `javascript:`. */
function decodeCssEscapes(text: string): string {
  return text.replace(CSS_ESCAPE_REGEX, (_whole, hex, literal) => {
    if (literal !== undefined) return literal
    const codePoint = parseInt(hex, 16)
    return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '\ufffd'
  })
}

/** Whether what is inside a `url()` is kept: a reference inside the document, or an image held in the value. */
function isAllowedCssUrl(inside: string): boolean {
  const target = normalizeLink(inside.replace(/^["']|["']$/g, ''))
  return target.startsWith('#') || target.startsWith('data:image/')
}

/** Remove `@import` rules, script constructs, and every `url()` that is not local or an image held in the value. */
function cleanCssText(text: string): string {
  return text
    .replace(CSS_IMPORT_REGEX, '')
    .replace(CSS_SCRIPT_CONSTRUCT_REGEX, 'removed(')
    .replace(CSS_URL_REGEX, (whole, inside: string) => (isAllowedCssUrl(inside) ? whole : 'none'))
}

/**
 * Clean the text of a style element or a style attribute.
 *
 * A browser reads style sheet escapes, so `@\69mport` is an import and `url(\6a avascript:...)` is a script
 * link. The text is checked once as written and once with escapes read. If reading the escapes
 * uncovers something the first pass did not remove, the whole text is dropped rather than
 * rewritten, because cutting it correctly would mean parsing style sheet.
 */
export function cleanCss(text: string): string {
  const cleaned = cleanCssText(text)
  if (!text.includes('\\')) return cleaned
  const decoded = decodeCssEscapes(text)
  return cleanCssText(decoded) === decoded ? cleaned : ''
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/** The part of a name after its prefix. */
function localNameOf(name: string): string {
  return name.slice(name.indexOf(':') + 1)
}

/** Whether an attribute is a link: `href` or `src` under any prefix. */
function isLinkAttribute(attribute: Attr): boolean {
  const name = attribute.localName.toLowerCase()
  return name === 'href' || name === 'src'
}

/** Whether an attribute is an event handler. */
function isHandlerAttribute(attribute: Attr): boolean {
  return attribute.localName.toLowerCase().startsWith('on')
}

/** A node's attributes as a plain array, safe to remove from while looping. */
function attributesOf(element: Element): Attr[] {
  return Array.from({ length: element.attributes.length }, (_, index) => element.attributes.item(index) as Attr)
}

/** Whether an animation element would rewrite a link or an event handler. */
function targetsLinkOrHandler(element: Element): boolean {
  const target = normalizeLink(element.getAttribute('attributeName') ?? '')
  const name = localNameOf(target)
  return name === 'href' || name === 'src' || name.startsWith('on')
}

/** Whether an element is removed with everything inside it. */
function isRemovedElement(element: Element): boolean {
  if (element.namespaceURI !== SVG_NAMESPACE) return true
  const name = element.localName
  if (!ALLOWED_ELEMENTS.has(name)) return true
  if (ANIMATION_ELEMENTS.has(name) && targetsLinkOrHandler(element)) return true
  if (name !== 'use') return false
  const links = attributesOf(element).filter(isLinkAttribute)
  return links.some((link) => !isLocalLink(link.value))
}

/** Clean one attribute of a kept element, in place. */
function cleanAttribute(element: Element, attribute: Attr): void {
  if (isHandlerAttribute(attribute)) {
    element.removeAttributeNode(attribute)
    return
  }
  if (isLinkAttribute(attribute)) {
    if (isUnsafeLink(attribute.value)) attribute.value = NEUTRAL_LINK
    return
  }
  const isStyle = attribute.name === 'style'
  if (isStyle || /url\(/i.test(attribute.value)) attribute.value = cleanCss(attribute.value)
}

/** Clean the text inside a style element. Anything but text is removed. */
function cleanStyleContent(element: Element): void {
  for (const child of Array.from(element.childNodes)) {
    const isText = child.nodeType === TEXT_NODE || child.nodeType === CDATA_SECTION_NODE
    if (!isText) {
      element.removeChild(child)
      continue
    }
    ;(child as CharacterData).data = cleanCss((child as CharacterData).data)
  }
}

/** Clean an element's children, then its attributes. Recurses once per level of nesting. */
function cleanChildren(parent: Node): void {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType !== ELEMENT_NODE) {
      // Text and CDATA are kept; comments, processing instructions and the like are not.
      if (child.nodeType !== TEXT_NODE && child.nodeType !== CDATA_SECTION_NODE) parent.removeChild(child)
      continue
    }
    const element = child as Element
    if (isRemovedElement(element)) {
      parent.removeChild(element)
      continue
    }
    attributesOf(element).forEach((attribute) => cleanAttribute(element, attribute))
    if (element.localName === 'style') cleanStyleContent(element)
    else cleanChildren(element)
  }
}

// ---------------------------------------------------------------------------
// Reading and writing bytes
// ---------------------------------------------------------------------------

/** Matches the encoding named in an markup declaration at the very start of a document. */
const DECLARED_ENCODING_REGEX = /^<\?xml[^>]*?\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/

/** Byte order marks that name an encoding. */
const BYTE_ORDER_MARKS: readonly { readonly bytes: readonly number[]; readonly encoding: string }[] = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: 'utf-8' },
  { bytes: [0xff, 0xfe], encoding: 'utf-16le' },
  { bytes: [0xfe, 0xff], encoding: 'utf-16be' },
]

/** The encoding a document is written in: its byte order mark, else its declaration, else eight-bit Unicode encoding. */
function encodingOf(image: Buffer): string {
  const mark = BYTE_ORDER_MARKS.find(({ bytes }) => bytes.every((byte, index) => image[index] === byte))
  if (mark) return mark.encoding
  const declared = DECLARED_ENCODING_REGEX.exec(image.subarray(0, 200).toString('latin1'))
  return declared ? declared[1] : 'utf-8'
}

/** Decode a document to text, honouring the encoding it declares. Throws for one Node does not know. */
function decodeDocument(image: Buffer): string {
  return new TextDecoder(encodingOf(image), { fatal: true }).decode(image)
}

/** Throws on anything the parser calls an error, so a document it cannot read in full is never kept. */
function rejectOnError(level: string, message: string): void {
  if (level === 'warning') return
  throw new SvgRejectedError(message)
}

/**
 * Parse an vector image, remove everything unsafe, and write it back.
 *
 * @param image The vector image bytes.
 * @returns The sanitized document as eight-bit Unicode encoding. It has no declaration, document type, comment or processing instruction.
 * @throws {SvgRejectedError} When the document is not well formed, does not start with an `svg`
 *   element in the vector image namespace, or uses an entity (none are expanded).
 */
export function sanitizeSvgDocument(image: Buffer): Buffer {
  try {
    const text = decodeDocument(image).replace(/^\ufeff/, '')
    const document = new DOMParser({ onError: rejectOnError }).parseFromString(text, 'image/svg+xml')
    const root = document.documentElement
    if (!root || root.namespaceURI !== SVG_NAMESPACE || root.localName !== ROOT_ELEMENT) {
      throw new SvgRejectedError('the root element is not an svg element in the SVG namespace')
    }
    // The parser's document type is narrower than the browser's, but it has the members used here.
    cleanChildren(document as unknown as Node)
    // The root is an element of the document node, so this also cleans its attributes; a document type,
    // comment or processing instruction beside it is removed here too.
    return Buffer.from(new XMLSerializer().serializeToString(document), 'utf-8')
  } catch (error) {
    if (error instanceof SvgRejectedError) throw error
    throw new SvgRejectedError('the document could not be read', { cause: error })
  }
}
