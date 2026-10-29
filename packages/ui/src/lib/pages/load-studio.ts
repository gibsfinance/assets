/**
 * @module load-studio
 * One door to the Studio code, shared by the route and by every early fetch.
 *
 * The Studio is a separate chunk. A visitor who clicks the link used to wait for a
 * round trip before anything could render. Starting the same import earlier, on
 * intent or at idle, moves that wait to a moment when nothing needs the result.
 * The route and the early fetches must call the same function: the module system
 * then answers every call after the first from one promise.
 */
import type { ComponentType } from 'react'

/** How long the home page waits for an idle moment before it fetches the Studio anyway. */
export const STUDIO_IDLE_TIMEOUT_MILLISECONDS = 2000

/**
 * Import the Studio page module.
 *
 * @returns The module whose default export is the Studio page.
 */
export const loadStudio = (): Promise<{ default: ComponentType }> => import('./Studio')

/**
 * Start fetching the Studio code without waiting for it.
 *
 * A failed fetch is swallowed here on purpose. Nothing is waiting on this call, and
 * the route that really needs the page imports it again and shows its own failure.
 */
export const prefetchStudio = (): void => {
  loadStudio().catch(() => undefined)
}

/**
 * Fetch the Studio code the next time the browser is idle.
 *
 * Uses `requestIdleCallback` where it exists and a timer where it does not, which is
 * Safari. Either way the fetch starts at most `STUDIO_IDLE_TIMEOUT_MILLISECONDS` after
 * the call, so a busy page cannot postpone it forever.
 *
 * @returns A function that cancels the fetch if it has not started.
 */
export const prefetchStudioWhenIdle = (): (() => void) => {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(prefetchStudio, { timeout: STUDIO_IDLE_TIMEOUT_MILLISECONDS })
    return () => window.cancelIdleCallback(handle)
  }
  const handle = setTimeout(prefetchStudio, STUDIO_IDLE_TIMEOUT_MILLISECONDS)
  return () => clearTimeout(handle)
}
