import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describeNativeSelects, findNativeSelects, hasNativeSelect } from './no-native-select.ts'

describe('hasNativeSelect', () => {
  it.each(['<select>', '<select name="a">', '<SELECT\n>', '<select/>', 'a <label><select autocomplete="off"><option>'])(
    'finds a select in %j',
    (html) => {
      expect(hasNativeSelect(html)).toBe(true)
    },
  )

  it.each(['<p>no menu</p>', '&lt;select&gt; in a code sample', '<selection>', '<div role="menu"></div>'])(
    'does not flag %j',
    (html) => {
      expect(hasNativeSelect(html)).toBe(false)
    },
  )
})

describe('findNativeSelects', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'no-select-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('names each page with a select, in sorted order, including nested pages', async () => {
    await mkdir(path.join(directory, 'guide', 'deep'), { recursive: true })
    await writeFile(path.join(directory, 'index.html'), '<main></main>')
    await writeFile(path.join(directory, 'guide', 'deep', 'index.html'), '<select></select>')
    await writeFile(path.join(directory, 'a.html'), '<select>')
    await writeFile(path.join(directory, 'notes.txt'), '<select>')
    expect(await findNativeSelects(directory)).toEqual(['a.html', path.join('guide', 'deep', 'index.html')])
  })

  it('returns nothing for a clean site', async () => {
    await writeFile(path.join(directory, 'index.html'), '<div role="menu"></div>')
    expect(await findNativeSelects(directory)).toEqual([])
  })
})

describe('describeNativeSelects', () => {
  it('says nothing when there is nothing to report', () => {
    expect(describeNativeSelects([])).toBeUndefined()
  })

  it('names every file', () => {
    const message = describeNativeSelects(['a.html', 'b/index.html'])
    expect(message).toContain('  a.html')
    expect(message).toContain('  b/index.html')
    expect(message).toContain('design/design-language')
  })
})
