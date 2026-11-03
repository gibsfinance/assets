/**
 * Decisions the service worker makes, held as pure functions so each is tested
 * without a browser. The event wiring in `worker.ts` only applies their answers.
 */

/** Bump to discard every cache an earlier worker wrote. The activate step deletes all other names. */
export const CACHE_VERSION = 'v1'

/** The one cache this worker owns. */
export const CACHE_NAME = `gib-shell-${CACHE_VERSION}`

/** The key the page shell is stored under, and the address it is refreshed from. */
export const SHELL_URL = '/index.html'

/** What the worker does with a request. */
export type RequestPlan = 'shell' | 'asset' | 'ignore'

/** The parts of a request the plan depends on. */
export type RequestFacts = { method: string; mode: string; url: string }

/**
 * Chooses a strategy for one request.
 *
 * Only three things are handled: a page navigation to the site root (the shell,
 * stale-while-revalidate), and a GET for a hashed file under `/assets/` (cache first,
 * because the name changes whenever the bytes do). Everything else passes straight
 * through: API calls, images, other origins, and any method but GET.
 *
 * @param request The method, fetch mode, and absolute address of the request.
 * @param origin The origin the worker runs on, such as `https://gib.show`.
 */
export function planRequest(request: RequestFacts, origin: string): RequestPlan {
  if (request.method !== 'GET') return 'ignore'
  const url = new URL(request.url)
  if (url.origin !== origin) return 'ignore'
  if (url.pathname.startsWith('/assets/')) return 'asset'
  const isShellPath = url.pathname === '/' || url.pathname === SHELL_URL
  if (request.mode === 'navigate' && isShellPath) return 'shell'
  return 'ignore'
}

/** Matches a built file reference such as `./assets/index-ab12.js` or `/assets/x.woff2`. */
const ASSET_REFERENCE = /(?:\.\/|\/)assets\/[\w.~%-]+/g

/**
 * Lists the built files a page names, as root-relative paths, without repeats. It reads
 * the whole text, so it finds scripts, preloads, and the font urls inside the inline style.
 */
export function extractAssetPaths(html: string): string[] {
  const found = html.match(ASSET_REFERENCE) ?? []
  return [...new Set(found.map((reference) => reference.replace(/^\./, '')))]
}

/** The cached paths that the current page no longer names, and so can go. */
export function selectStalePaths(cachedPaths: string[], referencedPaths: string[]): string[] {
  const referenced = new Set(referencedPaths)
  return cachedPaths.filter((path) => path.startsWith('/assets/') && !referenced.has(path))
}

/** The paths named by the page that the cache does not hold yet. */
export function selectMissingPaths(cachedPaths: string[], referencedPaths: string[]): string[] {
  const cached = new Set(cachedPaths)
  return referencedPaths.filter((path) => !cached.has(path))
}

/** The names of caches that belong to another version of the worker. */
export function selectOldCacheNames(names: string[]): string[] {
  return names.filter((name) => name !== CACHE_NAME)
}

/**
 * Whether a fetched page is fit to store as the shell. A redirected answer cannot be
 * handed to a navigation, and an error page must never become the offline copy.
 */
export function isStorableShell(response: { ok: boolean; redirected: boolean }): boolean {
  return response.ok && !response.redirected
}
