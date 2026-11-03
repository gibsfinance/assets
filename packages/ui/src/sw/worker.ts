import {
  CACHE_NAME,
  SHELL_URL,
  extractAssetPaths,
  isStorableShell,
  planRequest,
  selectMissingPaths,
  selectOldCacheNames,
  selectStalePaths,
} from './worker-logic'

/** An event that can hold the worker alive while background work finishes. */
export type ExtendableLike = { waitUntil: (work: Promise<unknown>) => void }

/** A fetch event, reduced to what the worker uses. */
export type FetchEventLike = ExtendableLike & {
  request: Request
  respondWith: (answer: Promise<Response>) => void
}

/** The browser services the worker needs. Tests pass fakes. */
export type WorkerDependencies = {
  caches: CacheStorage
  fetchFile: typeof fetch
  origin: string
  skipWaiting: () => Promise<void>
  claimClients: () => Promise<void>
}

/** The three handlers `sw.ts` attaches to the worker scope. */
export type WorkerHandlers = {
  onInstall: (event: ExtendableLike) => void
  onActivate: (event: ExtendableLike) => void
  onFetch: (event: FetchEventLike) => void
}

/** Paths of the hashed files a cache holds. */
const cachedAssetPaths = async (cache: Cache): Promise<string[]> =>
  (await cache.keys()).map((request) => new URL(request.url).pathname)

/**
 * Builds the worker's event handlers over the given services.
 *
 * - Shell: answer from the cache at once and refresh it in the background. With no
 *   copy yet, go to the network.
 * - Assets: cache first, since a hashed name never changes its bytes.
 * - Anything else: no `respondWith`, so the browser handles it as if no worker existed.
 */
export function createWorker(dependencies: WorkerDependencies): WorkerHandlers {
  const { caches, fetchFile, origin } = dependencies
  const openCache = () => caches.open(CACHE_NAME)

  /** Fetches and stores whichever of the named files the cache does not hold. */
  const precache = async (cache: Cache, paths: string[]): Promise<void> => {
    const missing = selectMissingPaths(await cachedAssetPaths(cache), paths)
    await Promise.allSettled(
      missing.map(async (path) => {
        const response = await fetchFile(path)
        if (response.ok) await cache.put(path, response)
      }),
    )
  }

  /**
   * Stores a page as the shell. When the page changed, also fetches the files it names
   * and drops the ones it no longer names, so the cache follows the deploy and stays small.
   */
  const storeShell = async (response: Response): Promise<void> => {
    if (!isStorableShell(response)) return
    const cache = await openCache()
    const html = await response.clone().text()
    const previous = await cache.match(SHELL_URL, { ignoreVary: true })
    if (previous && (await previous.text()) === html) return
    await cache.put(SHELL_URL, response)
    const referenced = extractAssetPaths(html)
    await precache(cache, referenced)
    const stale = selectStalePaths(await cachedAssetPaths(cache), referenced)
    await Promise.all(stale.map((path) => cache.delete(path)))
  }

  /** Asks the network for a current page and stores it. A failure leaves the old copy. */
  const refreshShell = async (): Promise<void> => {
    try {
      await storeShell(await fetchFile(SHELL_URL, { cache: 'no-cache' }))
    } catch {
      // Offline or the server is down: the copy we already have stays in use.
    }
  }

  /** The page to answer with, and the background work that must outlive the answer. */
  const answerShell = async (request: Request): Promise<{ response: Response; background: Promise<unknown> }> => {
    const cached = await (await openCache()).match(SHELL_URL, { ignoreVary: true })
    if (cached) return { response: cached, background: refreshShell() }
    const response = await fetchFile(request)
    return { response, background: storeShell(response.clone()).catch(() => undefined) }
  }

  const answerAsset = async (request: Request): Promise<Response> => {
    const cache = await openCache()
    const cached = await cache.match(request, { ignoreVary: true })
    if (cached) return cached
    const response = await fetchFile(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  }

  return {
    onInstall(event) {
      event.waitUntil(Promise.all([dependencies.skipWaiting(), refreshShell()]))
    },
    onActivate(event) {
      const removeOldCaches = async () => {
        const stale = selectOldCacheNames(await caches.keys())
        await Promise.all(stale.map((name) => caches.delete(name)))
      }
      event.waitUntil(Promise.all([removeOldCaches(), dependencies.claimClients()]))
    },
    onFetch(event) {
      const plan = planRequest(event.request, origin)
      if (plan === 'shell') {
        const outcome = answerShell(event.request)
        event.respondWith(outcome.then((answer) => answer.response))
        event.waitUntil(
          outcome.then(
            (answer) => answer.background,
            () => undefined,
          ),
        )
      }
      if (plan === 'asset') event.respondWith(answerAsset(event.request))
    },
  }
}
