/** The slice of the browser the registration reads. Tests pass fakes. */
export type RegistrationEnvironment = {
  /** True only in a production build with the worker switched on. */
  enabled: boolean
  navigator: { serviceWorker?: { register: (url: string, options: { scope: string }) => Promise<unknown> } }
  window: { addEventListener: (type: 'load', listener: () => void) => void; document: { readyState: string } }
}

/**
 * Registers `/sw.js` at the site root once the page has loaded, so the worker never
 * competes with first paint. Does nothing in development, in tests, or where the
 * browser has no service worker support. A failed registration is ignored: the site
 * works the same without the worker.
 */
export function registerServiceWorker(environment: RegistrationEnvironment): void {
  const { enabled, navigator, window } = environment
  if (!enabled || !navigator.serviceWorker) return
  const worker = navigator.serviceWorker
  const register = () => void worker.register('/sw.js', { scope: '/' }).catch(() => undefined)
  if (window.document.readyState === 'complete') return register()
  window.addEventListener('load', register)
}
