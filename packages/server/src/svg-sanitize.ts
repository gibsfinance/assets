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
 *   any prefix) that runs script or reads a file is replaced by `#`. A data address is replaced by `#`
 *   unless it is a picture the sniffer knows (PNG, JPEG, GIF, WebP or AVIF) whose size its own header
 *   states, within the document's pixel budget (see `cleanedEmbeddedRaster`). A picture whose label is
 *   wrong is relabelled to the type its bytes really are. An address whose label is not an image type is
 *   only read on an `image` element, which is where a browser would sniff it; anywhere else it is
 *   replaced by `#`. A nested vector address is replaced by `#`, because the document inside it is neither
 *   cleaned nor measured. A `use` with a link that is not local
 *   is removed.
 * - Animation: an animation element that targets a link or an `on*` attribute is removed.
 * - Styles: `@import` rules, `image-set()` values and `url()` values that are not local or `data:image` are
 *   removed from style elements and from every attribute. Every attribute value is checked, because a
 *   browser reads a presentation attribute as style sheet text, escapes included (`\75rl(` is `url(`).
 *   A `url(` that is never closed reads to the end of the text, so it is checked as well.
 * - Base address: `xml:base` is removed everywhere, because it makes a reference such as `#x` resolve
 *   against another document.
 * - Document: comments, processing instructions and the document type (with its entity
 *   declarations) are removed. The parser never expands an entity, so a document that uses one is
 *   rejected as unreadable instead of expanded.
 *
 * A document the parser cannot read is rejected with {@link SvgRejectedError}; it is never stored as is.
 */
import { DOMImplementation, DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { ImageRejectedError } from './image-rejected'
import { MAX_INPUT_PIXELS } from './untrusted-input'
import {
  EMBEDDED_RASTER_MEDIA_TYPES,
  readBase64Payload,
  readRasterDimensions,
  sniffRasterFormat,
} from './svg-raster-embed'

/** The vector image namespace. An element outside it is removed. */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/** The element name the document has to start with. */
const ROOT_ELEMENT = 'svg'

/** DOM node type numbers. */
const ELEMENT_NODE = 1
const TEXT_NODE = 3
const CDATA_SECTION_NODE = 4

/** Elements the walk keeps. Anything else in a vector image document is removed. */
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

/** Elements a style element may sit in. A style element anywhere else (inside a title, text or metadata) is removed. */
const STYLE_PARENT_ELEMENTS: ReadonlySet<string> = new Set([
  'svg',
  'defs',
  'g',
  'symbol',
  'a',
  'switch',
  'pattern',
  'mask',
  'clipPath',
  'marker',
])

/** Animation elements, which can rewrite another attribute and so are looked at twice. */
const ANIMATION_ELEMENTS: ReadonlySet<string> = new Set(['animate', 'animateTransform', 'animateMotion', 'set'])

/** Why a vector image could not be made safe to store. */
export class SvgRejectedError extends ImageRejectedError {
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

/** Whether a link value runs script or reads a file. Data addresses are judged by `cleanedLinkValue`, not here. */
function isUnsafeLink(value: string): boolean {
  const normalized = normalizeLink(value)
  return SCRIPT_SCHEME_REGEX.test(normalized) || normalized.startsWith('file:')
}

/** Whether a link value points inside the document. */
function isLocalLink(value: string): boolean {
  return normalizeLink(value).startsWith('#')
}

/** The replacement for a link that cannot be kept. */
const NEUTRAL_LINK = '#'

// ---------------------------------------------------------------------------
// Embedded pictures
// ---------------------------------------------------------------------------

/** The scheme every data address starts with, once normalized. */
const DATA_SCHEME = 'data:'

/** The start of a data address whose media type is an image type, once normalized. */
const IMAGE_DATA_PREFIX = 'data:image/'

/**
 * The start of a nested vector image address. Such an address is always blanked: the document inside it is neither
 * cleaned nor measured, so a picture over the pixel cap one level down was drawn in full (a 12000 by 12000 embed took
 * about a second). No logo seen in the artwork repositories nests one.
 */
const VECTOR_DATA_PREFIX = 'data:image/svg+xml'

/** The element whose address may hold a picture the browser sniffs even when its label is wrong. */
const IMAGE_ELEMENT = 'image'

/** A data address as a browser reads it: the declared media type, whether the payload is base64, and the payload as written. */
interface DataAddress {
  readonly declaredType: string
  readonly base64: boolean
  readonly payload: string
}

/**
 * Read the header of a data address. The header is normalized the way a browser reads a link, so a scheme written
 * with tabs or references is still found. The payload is kept as it was written, because base64 is case-sensitive.
 * The caller has already checked that the value reads as a data address, so the header starts with the scheme.
 *
 * @returns The address, or null when the value has no comma (there is no payload to read).
 */
function parseDataAddress(value: string): DataAddress | null {
  const comma = value.indexOf(',')
  if (comma < 0) return null
  const header = normalizeLink(value.slice(0, comma))
  const parameters = header.slice(DATA_SCHEME.length).split(';')
  const base64 = parameters.length > 1 && parameters[parameters.length - 1] === 'base64'
  return { declaredType: parameters[0], base64, payload: value.slice(comma + 1) }
}

/** The pixels the embedded pictures of one document may still draw. Starts at the cap and only goes down. */
interface PixelBudget {
  remaining: number
}

/**
 * The value an embedded picture keeps, or the neutral link when it cannot be kept.
 *
 * The payload must be well formed base64 and a picture the sniffer knows (PNG, JPEG, GIF, WebP or AVIF). Its size
 * comes from its own header, never from its label. A picture that cannot be sized, or that would pass the pixel
 * budget, is refused, and a refused picture spends nothing from the budget. A picture whose label was right is kept
 * as written; one whose label was wrong (or missing) is rewritten under the media type its bytes really are.
 * An address that is not base64 is refused, so nothing is relabelled that cannot be checked.
 */
function cleanedEmbeddedRaster(value: string, pixels: PixelBudget): string {
  const address = parseDataAddress(value)
  if (address === null || !address.base64) return NEUTRAL_LINK
  const payload = readBase64Payload(address.payload)
  if (payload === null) return NEUTRAL_LINK
  const format = sniffRasterFormat(payload.bytes)
  if (format === null) return NEUTRAL_LINK
  const dimensions = readRasterDimensions(payload.bytes, format)
  if (dimensions === null) return NEUTRAL_LINK
  const pixelCount = dimensions.width * dimensions.height
  if (pixelCount > pixels.remaining) return NEUTRAL_LINK
  pixels.remaining -= pixelCount
  const mediaType = EMBEDDED_RASTER_MEDIA_TYPES[format]
  if (address.declaredType === mediaType) return value
  return `data:${mediaType};base64,${payload.text}`
}

/**
 * The value a link attribute keeps. A data address is judged as a picture: only an address that is an image type
 * (or any address on an `image` element, which is where a browser would sniff a mislabelled picture) can keep
 * anything, and only as a picture whose bytes and size check out. Every other data address is neutralised, as before.
 */
function cleanedLinkValue(value: string, elementName: string, pixels: PixelBudget): string {
  const normalized = normalizeLink(value)
  if (!normalized.startsWith(DATA_SCHEME)) return isUnsafeLink(value) ? NEUTRAL_LINK : value
  if (normalized.startsWith(VECTOR_DATA_PREFIX)) return NEUTRAL_LINK
  if (normalized.startsWith(IMAGE_DATA_PREFIX) || elementName === IMAGE_ELEMENT)
    return cleanedEmbeddedRaster(value, pixels)
  return NEUTRAL_LINK
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** Matches a style sheet `@import` rule up to its semicolon, or to the end of the text when it has none. */
const CSS_IMPORT_REGEX = /@import\b[^;]*(?:;|$)/gi

/**
 * Matches a style sheet `url()` value, quoted or not. Group 1 is what is inside the parentheses. A
 * `url(` with no closing parenthesis runs to the end of the text, as a browser reads it, so the end
 * of the text closes it here.
 */
const CSS_URL_REGEX = /url\(\s*((?:"[^"]*"|'[^']*'|[^)]*))\s*(?:\)|$)/gi

/**
 * Finds the functions that take an address as a bare string, which the `url()` check never sees:
 * `image-set(` (and `-webkit-image-set(`), `image(` (and `-webkit-image(`), `cross-fade(` and
 * `element(`. A parenthesis inside a quoted string would end any attempt to cut out just the call,
 * so no cutting is tried: the whole declaration goes (see `dropRemoteFunctionDeclarations`).
 */
const CSS_REMOTE_FUNCTION_REGEX = /(?:image-set|image|cross-fade|element)\(/i

/** Ends a declaration, or the rule that holds it. */
const CSS_DECLARATION_END_REGEX = /[;}]/

/**
 * The most style sheet text, in characters, that one style element or attribute value may hold. Text
 * over it is not worth cleaning: a real logo has a few hundred characters, and a document that
 * carries more is rejected like any other document that cannot be read.
 */
export const MAX_STYLE_TEXT_LENGTH = 256 * 1024

/**
 * The most attributes one document may hold. A document with more is rejected. Cleaning costs time in
 * proportion to the attribute count (no removal from a list, so no quadratic step), so this bounds the
 * work as well as the correctness. Measured on one element with 199,990 attributes: about 2.0 to 2.7 seconds
 * when every attribute is kept, and 0.9 to 1.2 seconds when every attribute is dropped, on the development
 * machine (three runs each). Most of the time is the parse. Remote files are cleaned on a worker thread under
 * the request's window (see `sanitizer-pool.ts`), so the main thread is never held for this work; the collector
 * cleans on its own thread, with no window. Three real logos in the SmolDapp artwork (read from disk by the
 * collector, so the 512 KB download cap never applies) carry about 97,000 each; 50,000 refused them.
 */
export const MAX_ATTRIBUTES = 200_000

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

/**
 * Remove every declaration that holds one of the remote functions, from the start of the declaration (after the
 * previous `;` or `{`) to the next `;` or `}`, or to the end of the text. One pass, no nesting and no
 * quote handling, so it cannot be put out of step by a parenthesis or a quote inside a string.
 */
function dropRemoteFunctionDeclarations(text: string): string {
  const finder = new RegExp(CSS_REMOTE_FUNCTION_REGEX.source, 'gi')
  const stop = new RegExp(CSS_DECLARATION_END_REGEX.source, 'g')
  const kept: string[] = []
  let cursor = 0
  for (let found = finder.exec(text); found; found = finder.exec(text)) {
    let start = found.index
    while (start > cursor && text[start - 1] !== ';' && text[start - 1] !== '{') start -= 1
    stop.lastIndex = found.index
    const end = stop.exec(text)?.index ?? text.length
    kept.push(text.slice(cursor, start))
    cursor = end
    finder.lastIndex = end
  }
  kept.push(text.slice(cursor))
  return kept.join('')
}

/** Remove `@import` rules, script constructs, remote-function declarations, and every `url()` that is not local or an image held in the value. */
function cleanCssText(text: string): string {
  return dropRemoteFunctionDeclarations(text)
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

/**
 * Clean the text of a style element or of a `style` attribute. Longer text is refused: a logo's style
 * sheet is short, and the cleaning is not written for long input. Other attribute values are not
 * capped, because path data is long and is checked for remote loads like any other value.
 */
function cleanStyleText(text: string): string {
  if (text.length > MAX_STYLE_TEXT_LENGTH) {
    throw new SvgRejectedError(`style text is longer than ${MAX_STYLE_TEXT_LENGTH} characters`)
  }
  return cleanCss(text)
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
  return name === 'href' || name === 'src' || name === 'base' || name.startsWith('on')
}

/** The attributes that carry the value an animation sets. */
const ANIMATED_VALUE_ATTRIBUTES: ReadonlySet<string> = new Set(['to', 'from', 'by', 'values'])

/**
 * Whether an animation sets a value the style cleaning would change: a remote load, or a declaration
 * that holds one. A browser applies the value an animation sets whatever the animated attribute is, so
 * such an animation is removed whatever it targets.
 */
function setsRemoteValue(element: Element): boolean {
  return attributesOf(element).some(
    (attribute) => ANIMATED_VALUE_ATTRIBUTES.has(attribute.name) && cleanCss(attribute.value) !== attribute.value,
  )
}

/** The namespace the reserved `xml` prefix is bound to. */
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'

/** Whether an attribute is `xml:base`, which changes what every reference below it resolves against. */
function isBaseAttribute(attribute: Attr): boolean {
  if (attribute.namespaceURI === XML_NAMESPACE && attribute.localName === 'base') return true
  return attribute.name.toLowerCase() === 'xml:base'
}

/** Whether an element is removed with everything inside it. */
function isRemovedElement(element: Element): boolean {
  if (element.namespaceURI !== SVG_NAMESPACE) return true
  const name = element.localName
  if (!ALLOWED_ELEMENTS.has(name)) return true
  if (ANIMATION_ELEMENTS.has(name) && (targetsLinkOrHandler(element) || setsRemoteValue(element))) return true
  if (name === 'style') return !STYLE_PARENT_ELEMENTS.has((element.parentNode as Element).localName)
  if (name !== 'use') return false
  const links = attributesOf(element).filter(isLinkAttribute)
  return links.some((link) => !isLocalLink(link.value))
}

/** How many attributes the walk may still look at. */
interface AttributeBudget {
  remaining: number
}

/**
 * Where a cleaned copy is written, and how many attributes are left to look at. The source tree is only
 * read. Nothing is removed from a list: xmldom re-indexes a parent's children on every removal and shifts
 * an element's attributes on every attribute removal, so removing one at a time costs time in proportion
 * to the square of the count. Appending to a fresh parent costs the same for every node.
 */
interface CopyContext {
  output: Document
  budget: AttributeBudget
  pixels: PixelBudget
}

/**
 * The value an attribute keeps in the cleaned copy, or null when the attribute is dropped. Every
 * attribute counts against the budget, dropped or not.
 */
function cleanedAttributeValue(element: Element, attribute: Attr, context: CopyContext): string | null {
  context.budget.remaining -= 1
  if (context.budget.remaining < 0)
    throw new SvgRejectedError(`the document has more than ${MAX_ATTRIBUTES} attributes`)
  if (isHandlerAttribute(attribute) || isBaseAttribute(attribute)) return null
  if (isLinkAttribute(attribute)) return cleanedLinkValue(attribute.value, element.localName, context.pixels)
  // Every other value is read as style sheet text too: a presentation attribute is, and its escapes
  // can spell `url(` without the raw text ever containing it. A value is one declaration's value, so
  // one that holds a remote function is dropped whole.
  const cleaned = attribute.name === 'style' ? cleanStyleText(attribute.value) : cleanCss(attribute.value)
  return CSS_REMOTE_FUNCTION_REGEX.test(attribute.value) ? '' : cleaned
}

/**
 * The text a style element keeps: its cleaned text as one plain text node. Text, not a CDATA section: a
 * CDATA section is written back raw, so `</style><script>` inside one is inert to a markup parser but ends
 * the style element in a web page parser, which matters when a page inlines the file. A text node has `<`
 * and `&` escaped when it is written. Style sheets never need a `<`, so text that still has one after
 * cleaning is dropped.
 */
function copyStyleContent(source: Element, copy: Element, context: CopyContext): void {
  const text = Array.from(source.childNodes)
    .filter((child) => child.nodeType === TEXT_NODE || child.nodeType === CDATA_SECTION_NODE)
    .map((child) => (child as CharacterData).data)
    .join('')
  const cleaned = cleanStyleText(text)
  if (cleaned === '' || cleaned.includes('<')) return
  copy.appendChild(context.output.createTextNode(cleaned))
}

/** Copy one kept element with its cleaned attributes and children, or nothing when it is removed. */
function copyElement(element: Element, parent: Node, context: CopyContext): void {
  if (isRemovedElement(element)) return
  const copy = context.output.createElementNS(element.namespaceURI, element.nodeName)
  for (const attribute of attributesOf(element)) {
    const value = cleanedAttributeValue(element, attribute, context)
    if (value === null) continue
    // `setAttributeNode` finds an existing attribute through the element's index. `setAttributeNS` looks
    // it up by scanning the whole list, which makes writing n attributes cost n squared.
    const kept = context.output.createAttributeNS(attribute.namespaceURI, attribute.name)
    kept.value = kept.nodeValue = value
    copy.setAttributeNode(kept)
  }
  parent.appendChild(copy)
  if (element.localName === 'style') copyStyleContent(element, copy, context)
  else copyChildren(element, copy, context)
}

/**
 * Copy an element's children into `parent`. Text and CDATA become escaped text, so the content can never
 * read as markup in a web page parser. Comments, processing instructions and the like are dropped.
 */
function copyChildren(source: Node, parent: Node, context: CopyContext): void {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === CDATA_SECTION_NODE || child.nodeType === TEXT_NODE) {
      parent.appendChild(context.output.createTextNode((child as CharacterData).data))
    } else if (child.nodeType === ELEMENT_NODE) {
      copyElement(child as Element, parent, context)
    }
  }
}

// ---------------------------------------------------------------------------
// Reading and writing bytes
// ---------------------------------------------------------------------------

/** Matches the encoding named in a markup declaration at the very start of a document. */
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
 * Parse a vector image, remove everything unsafe, and write it back.
 *
 * @param image The vector image bytes.
 * @returns The sanitized document as eight-bit Unicode encoding. It has no declaration, document type, comment or processing instruction.
 * @throws {SvgRejectedError} When the document is not well formed, does not start with an `svg`
 *   element in the vector image namespace, or uses an entity (none are expanded).
 */
export function sanitizeSvgDocument(image: Buffer): Buffer {
  try {
    const text = decodeDocument(image).replace(/^\ufeff/, '')
    // Positions are not read, and recording one per node costs about half the parse time.
    const document = new DOMParser({ onError: rejectOnError, locator: false }).parseFromString(text, 'image/svg+xml')
    const root = document.documentElement
    if (!root || root.namespaceURI !== SVG_NAMESPACE || root.localName !== ROOT_ELEMENT) {
      throw new SvgRejectedError('the root element is not an svg element in the SVG namespace')
    }
    // The cleaned document holds what the walk keeps at the top level: the root, and the whitespace the parser
    // leaves before and after it. A document type, comment or processing instruction beside the root is not
    // copied, so it is removed here too.
    // An empty qualified name makes no root element; the root is copied in below.
    const xmlOutput = new DOMImplementation().createDocument(null, '', null)
    const output = xmlOutput as unknown as Document
    copyChildren(document as unknown as Node, output, {
      output,
      budget: { remaining: MAX_ATTRIBUTES },
      pixels: { remaining: MAX_INPUT_PIXELS },
    })
    return Buffer.from(new XMLSerializer().serializeToString(xmlOutput), 'utf-8')
  } catch (error) {
    if (error instanceof SvgRejectedError) throw error
    throw new SvgRejectedError('the document could not be read', { cause: error })
  }
}
