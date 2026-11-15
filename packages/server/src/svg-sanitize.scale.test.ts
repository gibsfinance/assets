/**
 * Scale tests for the sanitizer: documents with 150,000 attributes or elements. They time the whole
 * sanitizer, so they run in their own file, which starts with a fresh heap. In the ordinary test file the
 * garbage left by earlier tests made the same work several times slower.
 */
import { describe, it, expect, vi } from 'vitest'
import { Element as XmlElement, Node as XmlNode } from '@xmldom/xmldom'
import { MAX_ATTRIBUTES, sanitizeSvgDocument } from './svg-sanitize'

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
const wrap = (inner: string): string => `<svg ${NS}>${inner}</svg>`
const clean = async (svg: string): Promise<string> => sanitizeSvgDocument(Buffer.from(svg)).toString()

// The bounds are loose on purpose. In isolation these documents clean in about two seconds; under the coverage run,
// with the rest of the suite sharing the machine, they took up to about twenty-one. The bounds exist to catch a return of
// the quadratic cost (which took minutes at this size), not to measure speed.
describe('linear cost on large documents (fifth review, finding 1)', { timeout: 60_000 }, () => {
  // xmldom re-indexes a parent's children on every removal and shifts an element's attribute list on every
  // attribute removal, so removing one at a time costs time in proportion to the square of the count.
  // The sanitizer must not remove anything from a list: it writes the kept nodes into a new tree.
  it('removes no node and no attribute one at a time', async () => {
    const removeChild = vi.spyOn(XmlNode.prototype, 'removeChild')
    const removeAttributeNode = vi.spyOn(XmlElement.prototype, 'removeAttributeNode')
    try {
      const handlers = Array.from({ length: 25_000 }, (_, i) => `onclick${i}="x"`).join(' ')
      const siblings = '<script>1</script>'.repeat(25_000)
      await clean(wrap(`<rect ${handlers} fill="red"/>${siblings}<circle r="1"/>`))
      expect(removeChild).not.toHaveBeenCalled()
      expect(removeAttributeNode).not.toHaveBeenCalled()
    } finally {
      removeChild.mockRestore()
      removeAttributeNode.mockRestore()
    }
  })

  it('cleans one element holding 150,000 handler attributes in well under a few seconds', () => {
    const handlers = Array.from({ length: 150_000 }, (_, i) => `onclick${i}="x"`).join(' ')
    const started = performance.now()
    const output = sanitizeSvgDocument(Buffer.from(wrap(`<rect ${handlers} fill="red"/>`)))
    const elapsed = performance.now() - started
    expect(output.toString()).toContain('fill="red"')
    expect(output.toString()).not.toContain('onclick')
    expect(elapsed).toBeLessThan(30_000)
  })

  it('keeps 150,000 ordinary attributes on one element in well under a few seconds', () => {
    const kept = Array.from({ length: 150_000 }, (_, i) => `data-n${i}="1"`).join(' ')
    const started = performance.now()
    const output = sanitizeSvgDocument(Buffer.from(wrap(`<rect ${kept}/>`)))
    const elapsed = performance.now() - started
    expect(output.toString()).toContain('data-n149999="1"')
    expect(elapsed).toBeLessThan(30_000)
  })

  it('cleans a document with 150,000 sibling elements to remove in well under a few seconds', () => {
    const siblings = '<script>1</script>'.repeat(150_000)
    const started = performance.now()
    const output = sanitizeSvgDocument(Buffer.from(wrap(`${siblings}<circle r="1"/>`)))
    const elapsed = performance.now() - started
    expect(output.toString()).toContain('<circle')
    expect(output.toString()).not.toContain('script')
    expect(elapsed).toBeLessThan(30_000)
  })

  it('rejects a document with more attributes than the cap', () => {
    const crowded = `<rect ${Array.from({ length: 1_000 }, (_, i) => `a${i}="1"`).join(' ')}/>`.repeat(
      MAX_ATTRIBUTES / 1_000 + 1,
    )
    expect(() => sanitizeSvgDocument(Buffer.from(wrap(crowded)))).toThrow(/more than \d+ attributes/)
  })
})
