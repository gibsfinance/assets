/**
 * @module image-store/xml
 * Just enough XML reading for the listing answers of S3 and Azure. Their listings are flat,
 * machine-written and use no attributes, so a parser of every element is not needed.
 */

const ENTITIES: Readonly<Record<string, string>> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
}

/** Replaces the five predefined XML entities and numeric character references in a text. */
const decode = (text: string): string =>
  text
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&(lt|gt|quot|apos|amp);/g, (entity) => ENTITIES[entity])

/**
 * The text inside the first `<tag>` of a fragment.
 *
 * @param xml An XML fragment.
 * @param tag An element name.
 * @returns The decoded text, or undefined when the element is not there.
 */
export function readElement(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match ? decode(match[1]) : undefined
}

/**
 * The raw content of every `<tag>...</tag>` in a fragment, in order. The content is not decoded,
 * so it can be handed on to {@link readElement}.
 *
 * @param xml An XML fragment.
 * @param tag An element name.
 */
export function readBlocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((match) => match[1])
}
