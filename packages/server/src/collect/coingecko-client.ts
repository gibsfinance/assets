/**
 * @module collect/coingecko-client
 *
 * A small CoinGecko HTTP client: spaces requests, retries rate-limit and server errors with
 * a growing wait, and answers `null` when a request cannot be completed. It never throws
 * for a failed request, so a caller can leave a list alone and carry on with the next one.
 */
import { delay } from '../utils/delay'
import type { CoinGeckoTopTokensSettings } from './coingecko-top-tokens-settings'

/** Most retries for one request before it is given up. */
export const MAXIMUM_RETRIES = 5

/** How long to wait after a 429 answer that carries no `retry-after` header. */
export const RATE_LIMIT_WAIT_MS = 60_000

/** The wait after a server error or a dropped connection grows by this much per retry. */
export const SERVER_ERROR_WAIT_STEP_MS = 5_000

/** Query parameters; a value of `undefined` is left out. */
export type QueryParameters = Record<string, string | number | boolean | undefined>

/** What the client needs from the outside world. Every part can be replaced in a test. */
export type CoinGeckoClientDependencies = {
  settings: Pick<CoinGeckoTopTokensSettings, 'baseUrl' | 'headers'>
  /** Resolves when the next request may start. */
  waitForTurn: () => Promise<unknown>
  fetchImpl?: typeof fetch
  /** Signal-aware pause, in milliseconds. */
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  /** Receives one line per retry or failure. */
  log?: (message: string) => void
}

/** A client bound to one set of settings. */
export type CoinGeckoClient = {
  /**
   * Get a JSON document, or `null` when the request was aborted, answered with a client error,
   * or still failing after `MAXIMUM_RETRIES` retries.
   */
  getJson: (path: string, query: QueryParameters, signal: AbortSignal) => Promise<unknown | null>
}

/** Join a path and query into a URL under `baseUrl`. */
export const buildUrl = (baseUrl: string, path: string, query: QueryParameters): string => {
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) search.set(name, String(value))
  }
  const queryString = search.toString()
  return queryString ? `${baseUrl}${path}?${queryString}` : `${baseUrl}${path}`
}

/** Seconds named by a `retry-after` header, as milliseconds; null when absent or not a number. */
export const retryAfterMilliseconds = (header: string | null): number | null => {
  if (header === null) return null
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null
}

/** Whether a status is worth another attempt: rate limited, or a server-side failure. */
export const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500

/**
 * Build a client.
 *
 * Each attempt waits for its turn first, because CoinGecko counts every request against the
 * per-minute limit, failed ones included. A 429 waits the `retry-after` the server names, or
 * a minute. A 5xx or a dropped connection waits five seconds longer on each retry. Any other
 * status is final.
 */
export const createCoinGeckoClient = ({
  settings,
  waitForTurn,
  fetchImpl = fetch,
  wait = delay,
  log = () => {},
}: CoinGeckoClientDependencies): CoinGeckoClient => ({
  getJson: async (path, query, signal) => {
    const url = buildUrl(settings.baseUrl, path, query)
    for (let attempt = 0; attempt <= MAXIMUM_RETRIES; attempt++) {
      if (signal.aborted) return null
      await waitForTurn()
      let retryWaitMs: number
      try {
        const response = await fetchImpl(url, { signal, headers: { accept: 'application/json', ...settings.headers } })
        if (response.ok) return (await response.json()) as unknown
        if (!isRetryableStatus(response.status)) {
          log(`${path} answered ${response.status}; giving up`)
          return null
        }
        retryWaitMs =
          response.status === 429
            ? (retryAfterMilliseconds(response.headers.get('retry-after')) ?? RATE_LIMIT_WAIT_MS)
            : SERVER_ERROR_WAIT_STEP_MS * (attempt + 1)
        log(`${path} answered ${response.status}; retry ${attempt + 1} of ${MAXIMUM_RETRIES}`)
      } catch (error) {
        if (signal.aborted) return null
        retryWaitMs = SERVER_ERROR_WAIT_STEP_MS * (attempt + 1)
        log(`${path} failed: ${(error as Error).message}; retry ${attempt + 1} of ${MAXIMUM_RETRIES}`)
      }
      if (attempt === MAXIMUM_RETRIES) break
      const aborted = await wait(retryWaitMs, signal).then(
        () => false,
        () => true,
      )
      if (aborted) return null
    }
    log(`${path} still failing after ${MAXIMUM_RETRIES} retries; giving up`)
    return null
  },
})
