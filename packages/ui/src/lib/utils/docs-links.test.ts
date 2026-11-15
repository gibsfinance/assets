import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DOCS_PAGES, DOCS_SITE_ROOT, getDocsUrl, type DocsPageName } from './docs-links'

/**
 * The documentation site's source. The UI tests run from the workspace directory (`packages/ui`),
 * so the sibling `docs` package is one level up. Resolving from `import.meta.url` does not work
 * here: vitest reports that address in a form the relative path cannot be taken from.
 */
const docsContentRoot = resolve(process.cwd(), '../docs/src/content/docs')

/** The source file a page path is served from: `/api-reference/images/` is `api-reference/images.md`. */
const sourceFileFor = (pagePath: string) => resolve(docsContentRoot, `${pagePath.replace(/^\/|\/$/g, '')}.md`)

describe('getDocsUrl', () => {
  it('builds the full address of a named page on the documentation site', () => {
    expect(getDocsUrl('imageOptions')).toBe('https://docs.gib.show/api-reference/image-options/')
  })

  it('sends the sprite card to the sprite sheets page', () => {
    expect(getDocsUrl('spriteSheets')).toBe('https://docs.gib.show/api-reference/sprite-sheets/')
  })

  it('answers from the documentation site root, not the instance the interface talks to', () => {
    expect(getDocsUrl('images').startsWith(`${DOCS_SITE_ROOT}/`)).toBe(true)
  })
})

describe('DOCS_PAGES', () => {
  const names = Object.keys(DOCS_PAGES) as DocsPageName[]

  it.each(names)('names a page that exists in the documentation source: %s', (name) => {
    const source = sourceFileFor(DOCS_PAGES[name])
    expect(existsSync(source), `missing ${source}`).toBe(true)
  })
})
