/** A forced reload is not repeated inside this window, so a real outage cannot loop. */
export const RELOAD_WINDOW_MS = 10_000

/** The sessionStorage key that records when the last forced reload happened. */
export const LAST_RELOAD_KEY = 'preload-error-reload-at'

/**
 * Whether a failed lazy import should reload the page.
 *
 * @param now The current time in milliseconds.
 * @param lastReloadAt When the previous forced reload happened, or `null` if none did.
 */
export function shouldReload(now: number, lastReloadAt: number | null): boolean {
  if (lastReloadAt === null) return true
  return now - lastReloadAt >= RELOAD_WINDOW_MS
}

/** The slice of the browser the recovery uses. Tests pass fakes. */
export type PreloadRecoveryEnvironment = {
  window: {
    addEventListener: (type: 'vite:preloadError', listener: (event: { preventDefault: () => void }) => void) => void
    sessionStorage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }
    location: { reload: () => void }
  }
  now: () => number
}

/**
 * Recovers from a lazy chunk that no longer exists.
 *
 * After a deploy, a page still running the old build asks for a hashed file the
 * server has replaced. Vite reports that as `vite:preloadError`. The service worker
 * has meanwhile cached the new page, so one reload lands on the new build. The
 * reload is recorded in session storage and not repeated within `RELOAD_WINDOW_MS`;
 * when storage is unavailable the loop cannot be guarded, so the error is left to
 * surface as it would have.
 */
export function installPreloadRecovery(environment: PreloadRecoveryEnvironment): void {
  const { window, now } = environment
  window.addEventListener('vite:preloadError', (event) => {
    const current = now()
    try {
      const stored = window.sessionStorage.getItem(LAST_RELOAD_KEY)
      if (!shouldReload(current, stored === null ? null : Number(stored))) return
      window.sessionStorage.setItem(LAST_RELOAD_KEY, String(current))
    } catch {
      return
    }
    event.preventDefault()
    window.location.reload()
  })
}
