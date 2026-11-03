/**
 * Entry of the service worker, built to `/sw.js` (see `vite.config.ts`). It only
 * attaches the handlers `createWorker` returns to the worker scope.
 */
import { createWorker, type ExtendableLike, type FetchEventLike } from './worker'

/** The slice of the worker scope this file touches. */
export type WorkerScope = {
  addEventListener: (type: string, listener: (event: never) => void) => void
  skipWaiting: () => Promise<void>
  clients: { claim: () => Promise<void> }
  location: { origin: string }
  caches: CacheStorage
  fetch: typeof fetch
}

/** Wires the worker onto a scope. Exported so a test can pass a fake scope. */
export function installServiceWorker(scope: WorkerScope): void {
  const worker = createWorker({
    caches: scope.caches,
    fetchFile: (input, init) => scope.fetch(input, init),
    origin: scope.location.origin,
    skipWaiting: () => scope.skipWaiting(),
    claimClients: () => scope.clients.claim(),
  })
  scope.addEventListener('install', worker.onInstall as (event: ExtendableLike) => void)
  scope.addEventListener('activate', worker.onActivate as (event: ExtendableLike) => void)
  scope.addEventListener('fetch', worker.onFetch as (event: FetchEventLike) => void)
}

installServiceWorker(self as unknown as WorkerScope)
