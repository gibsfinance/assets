/**
 * @module docs-links
 * Addresses of the documentation site, for the links the interface shows.
 *
 * The interface talks to whichever instance it was built for, but its documentation is one
 * site, so these addresses are fixed. Each name below is a page of the site, and the page
 * it names is a file under `packages/docs/src/content/docs/`. A test checks that every name
 * still has its page, so renaming a page there fails here rather than in a reader's browser.
 */

/** Where the documentation site is served. */
export const DOCS_SITE_ROOT = 'https://docs.gib.show'

/**
 * The pages the interface links to, by name. Each value is the page's path on the site.
 *
 * PLACEHOLDER for `spriteSheets`: it points at the generated endpoint reference until the
 * sprite page (planned at `/api-reference/sprites/`) exists. When it does, set this to that
 * path. The existing `/api-reference/sprite-sheets/` page is a candidate too, if the planned
 * page is not wanted.
 */
export const DOCS_PAGES = {
  images: '/api-reference/images/',
  networks: '/api-reference/networks/',
  tokenLists: '/api-reference/token-lists/',
  imageOptions: '/api-reference/image-options/',
  spriteSheets: '/reference/',
} as const

/**
 * Pages the documentation site builds from the server's definition rather than from a source
 * file. Each is named by the `base` the site's `starlightOpenAPI` plugin gives it.
 */
export const GENERATED_DOCS_PATHS: readonly string[] = ['/reference/']

/** The name of a page the interface links to. */
export type DocsPageName = keyof typeof DOCS_PAGES

/**
 * Builds the absolute address of a documentation page.
 *
 * @param page The name of the page, from `DOCS_PAGES`.
 * @returns The page's full address on the documentation site.
 */
export function getDocsUrl(page: DocsPageName): string {
  return `${DOCS_SITE_ROOT}${DOCS_PAGES[page]}`
}
