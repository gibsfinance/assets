/**
 * @module no-native-select
 * The design language forbids native `<select>` elements: a choice from a list is a menu.
 * This check reads the built site and finds any page that still has one, so a Starlight
 * component or a plugin cannot bring one back without the build failing.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

/** An opening `select` tag: `<select` followed by whitespace, `>` or `/`. Escaped text (`&lt;select`) does not match. */
const SELECT_TAG = /<select[\s>/]/i

/** Whether a page's HTML has a native select element. */
export const hasNativeSelect = (html: string): boolean => SELECT_TAG.test(html)

/**
 * Find every HTML file below a directory that has a native select element.
 *
 * @param directory The built site, for example `packages/docs/dist`.
 * @returns Paths relative to the directory, sorted. Empty when the site is clean.
 */
export const findNativeSelects = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { recursive: true })
  const pages = entries.filter((entry) => entry.endsWith('.html')).sort()
  const flags = await Promise.all(
    pages.map(async (page) => hasNativeSelect(await readFile(path.join(directory, page), 'utf8'))),
  )
  return pages.filter((_page, index) => flags[index])
}

/**
 * The message the build prints for a list of offending files.
 *
 * @returns `undefined` when the list is empty.
 */
export const describeNativeSelects = (files: readonly string[]): string | undefined => {
  if (files.length === 0) return undefined
  const list = files.map((file) => `  ${file}`).join('\n')
  return `Native <select> elements are not allowed. Use a menu (see design/design-language). Found in:\n${list}`
}
