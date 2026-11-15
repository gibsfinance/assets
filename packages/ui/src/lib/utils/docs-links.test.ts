import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DOCS_PAGES, DOCS_SITE_ROOT, GENERATED_DOCS_PATHS, getDocsUrl, type DocsPageName } from './docs-links'

/**
 * The documentation site's source. The UI tests run from the workspace directory (`packages/ui`),
 * so the sibling `docs` package is one level up. Resolving from `import.meta.url` does not work
 * here: vitest reports that address in a form the relative path cannot be taken from.
 */
const docsRoot = resolve(process.cwd(), '../docs')
const docsContentRoot = resolve(docsRoot, 'src/content/docs')

/** The source file a page path is served from: `/api-reference/images/` is `api-reference/images.md`. */
const sourceFileFor = (pagePath: string) => resolve(docsContentRoot, `${pagePath.replace(/^\/|\/$/g, '')}.md`)

describe('getDocsUrl', () => {
  it('builds the full address of a named page on the documentation site', () => {
    expect(getDocsUrl('imageOptions')).toBe('https://docs.gib.show/api-reference/image-options/')
  })

  it('sends the sprite card to the endpoint reference until its own page exists', () => {
    // Placeholder: the sprite page is planned at /api-reference/sprites/. Change this expectation
    // together with DOCS_PAGES.spriteSheets when that page lands.
    expect(getDocsUrl('spriteSheets')).toBe('https://docs.gib.show/reference/')
  })

  it('answers from the documentation site root, not the instance the interface talks to', () => {
    expect(getDocsUrl('images').startsWith(`${DOCS_SITE_ROOT}/`)).toBe(true)
  })
})

describe('DOCS_PAGES', () => {
  const names = Object.keys(DOCS_PAGES) as DocsPageName[]

  it.each(names)('names a page that exists in the documentation source: %s', (name) => {
    const pagePath = DOCS_PAGES[name]
    if (GENERATED_DOCS_PATHS.includes(pagePath)) {
      // A generated page has no source file. Its base must be the one the site builds it at.
      const config = readFileSync(resolve(docsRoot, 'astro.config.mjs'), 'utf8')
      expect(config).toContain(`base: '${pagePath.replace(/^\/|\/$/g, '')}'`)
      return
    }
    const source = sourceFileFor(pagePath)
    expect(existsSync(source), `missing ${source}`).toBe(true)
  })
})
