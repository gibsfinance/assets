import { describe, expect, it } from 'vitest'
import { readBlocks, readElement } from './xml'

describe('readElement', () => {
  it('reads the first element with that name', () => {
    expect(readElement('<A><B>one</B><B>two</B></A>', 'B')).toBe('one')
  })

  it('decodes the predefined entities and numeric references', () => {
    expect(readElement('<K>a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos; &#65;&#x42;</K>', 'K')).toBe('a&b<c>"d"\'e\' AB')
  })

  it('returns undefined when the element is absent, and an empty string when it is empty', () => {
    expect(readElement('<A></A>', 'B')).toBeUndefined()
    expect(readElement('<A><B></B></A>', 'B')).toBe('')
  })
})

describe('readBlocks', () => {
  it('returns the raw content of every element, in order, across lines', () => {
    expect(readBlocks('<L>\n<C><K>a&amp;</K></C>\n<C><K>b</K></C>\n</L>', 'C')).toEqual(['<K>a&amp;</K>', '<K>b</K>'])
  })

  it('returns nothing when there is no such element', () => {
    expect(readBlocks('<L></L>', 'C')).toEqual([])
  })
})
