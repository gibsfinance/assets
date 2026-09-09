/**
 * Filters over the documented endpoint list.
 */

/**
 * Whether an endpoint answers with an image rather than with JSON.
 *
 * The documentation page uses this to decide whether to render a response as a
 * picture or as a code block, so a wrong answer shows a user a wall of binary.
 */
export const isImageEndpoint = (url: string): boolean => url.includes('/image/') || url.includes('/sprite/')

/**
 * Keep the endpoints whose path or description contains the query.
 *
 * A blank query keeps everything, and returns the original array rather than a
 * copy — the documentation page holds thousands of rows and re-filtering on
 * every keystroke is the common case.
 */
export const filterEndpoints = <T extends { path: string; description: string }>(
  endpoints: T[],
  query: string,
): T[] => {
  if (!query.trim()) return endpoints
  const lower = query.toLowerCase()
  return endpoints.filter(
    (endpoint) => endpoint.path.toLowerCase().includes(lower) || endpoint.description.toLowerCase().includes(lower),
  )
}
