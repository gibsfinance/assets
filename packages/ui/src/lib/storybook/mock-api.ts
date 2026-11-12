/**
 * @module mock-api
 * Answers the interface's own requests inside Storybook, so no story reaches a network.
 *
 * A story lists the paths it expects under the `mockApi` parameter. While it is on screen,
 * `fetch` answers those paths from the fixtures, and answers any other path with a 404.
 */

/** One canned answer for one path. */
export type MockApiRoute =
  { kind: 'json'; body: unknown; status?: number; headers?: Record<string, string> } | { kind: 'never' }

/** Canned answers, keyed by URL path (no host, no query string). */
export type MockApiRoutes = Record<string, MockApiRoute>

/**
 * Pick the answer for a request.
 *
 * @param routes The story's canned answers.
 * @param pathname The request's URL path.
 * @returns The route, or `undefined` when the story did not list the path.
 */
export const findMockRoute = (routes: MockApiRoutes, pathname: string): MockApiRoute | undefined =>
  Object.hasOwn(routes, pathname) ? routes[pathname] : undefined

/**
 * Build a `fetch` stand-in that answers from the routes.
 *
 * @param routes The story's canned answers.
 * @param baseUrl What a relative address resolves against (the page's own address).
 */
export const createMockFetch =
  (routes: MockApiRoutes, baseUrl: string): typeof fetch =>
  (input, init) => {
    const address = input instanceof Request ? input.url : String(input)
    const route = findMockRoute(routes, new URL(address, baseUrl).pathname)
    if (route?.kind === 'never') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    }
    const status = route?.status ?? (route ? 200 : 404)
    const body = route ? route.body : { error: 'No fixture for this path' }
    const headers = { 'content-type': 'application/json', ...(route?.headers ?? {}) }
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers }))
  }

/**
 * Put the stand-in in place of `fetch` and return the function that restores it.
 * With no routes, nothing changes, so a story that needs no fixtures keeps the real `fetch`.
 *
 * @param routes The story's canned answers, if it has any.
 */
export const installMockApi = (routes: MockApiRoutes | undefined): (() => void) => {
  if (!routes) return () => {}
  const original = window.fetch
  window.fetch = createMockFetch(routes, window.location.href)
  return () => {
    window.fetch = original
  }
}
