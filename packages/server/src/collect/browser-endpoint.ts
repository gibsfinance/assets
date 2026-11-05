/**
 * @module collect/browser-endpoint
 * A loggable description of a remote browser's WebSocket address.
 *
 * Browserless authenticates with a `token` query parameter, so the full
 * `BROWSER_WS_ENDPOINT` is a secret. Logging it would copy the token into every
 * container log. This keeps the scheme, host, port and path, which is all a reader
 * needs to tell which browser the collector reached, and drops the query and any
 * user information.
 */

/**
 * Describe a browser endpoint without its credentials.
 *
 * @param endpoint The configured WebSocket address, e.g. `ws://browser:3000?token=…`.
 * @returns `ws://browser:3000/` for that input; `<unparseable endpoint>` when the
 *   value is not a URL, so a malformed setting can never be echoed back verbatim.
 */
export const describeBrowserEndpoint = (endpoint: string): string => {
  try {
    const url = new URL(endpoint)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return '<unparseable endpoint>'
  }
}
