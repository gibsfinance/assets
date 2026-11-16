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

/** The pages the interface links to, by name. Each value is the page's path on the site. */
export const DOCS_PAGES = {
  images: '/api-reference/images/',
  networks: '/api-reference/networks/',
  tokenLists: '/api-reference/token-lists/',
  imageOptions: '/api-reference/image-options/',
  spriteSheets: '/api-reference/sprite-sheets/',
} as const

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
