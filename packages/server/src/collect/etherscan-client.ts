/**
 * @module collect/etherscan-client
 *
 * One way to call the Etherscan API V2, with the plan's call rate respected and a backoff when
 * Etherscan says the rate was exceeded. Every call goes through here, so the key lives in one place,
 * never reaches a log, and the rate is kept by one clock.
 *
 * Rate limits: https://docs.etherscan.io/resources/rate-limits
 * (Free 3 calls per second and 100,000 per day; Lite 5; Standard 10; Advanced 20; Professional 30.)
 */
import { classifyEtherscanResponse, type EtherscanClassification } from './etherscan-response'

/** The single V2 address. The chain is chosen by the `chainid` parameter, not by the host. */
export const ETHERSCAN_API_URL = 'https://api.etherscan.io/v2/api'

/**
 * The endpoints the collector needs.
 *
 * `tokeninfo` is an API Pro endpoint (Standard plan and above) and is limited to 2 calls per second
 * on every plan, so `maximumCallsPerSecond` caps the plan's own rate
 * (https://docs.etherscan.io/api-reference/endpoint/tokeninfo).
 */
export const ETHERSCAN_ENDPOINTS = {
  tokeninfo: {
    module: 'token',
    action: 'tokeninfo',
    addressParameter: 'contractaddress',
    maximumCallsPerSecond: 2,
  },
} as const

/** The name of an endpoint in {@link ETHERSCAN_ENDPOINTS}. */
export type EtherscanEndpointName = keyof typeof ETHERSCAN_ENDPOINTS

/** How many times a call is repeated after a rate message before the answer is given as `rate-limited`. */
export const MAXIMUM_RATE_LIMIT_RETRIES = 4

/** The first wait after a rate message, in milliseconds. Each further wait doubles, up to the cap. */
export const RATE_LIMIT_BACKOFF_START_MS = 1000
const RATE_LIMIT_BACKOFF_CAP_MS = 8000

/** What a call returns. `result` is the raw `result` member and is only meaningful when the outcome is `ok`. */
export type EtherscanCall = {
  classification: EtherscanClassification
  result: unknown
}

/** One request for one address on one chain. */
export type EtherscanCallRequest = {
  chainId: number
  endpoint: EtherscanEndpointName
  address: string
}

/** A client bound to one key. */
export type EtherscanClient = {
  /**
   * Call an endpoint once per attempt, waiting for a free slot first, and repeating after a
   * rate message with a growing wait. Never throws for an Etherscan answer or a network fault:
   * both come back as a classification. Only an abort of `signal` rejects.
   */
  call: (request: EtherscanCallRequest) => Promise<EtherscanCall>
}

/** What the client needs from its surroundings. Tests replace every member. */
export type EtherscanClientOptions = {
  apiKey: string
  /** The plan's calls per second. Each endpoint's own cap lowers it further. */
  callsPerSecond: number
  fetchImplementation?: typeof fetch
  /** Waits `milliseconds`; rejects when `signal` aborts. */
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
  signal?: AbortSignal
}

const defaultSleep = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })

/**
 * Remove the key from text that may have been built from a request address. Network errors from
 * some runtimes quote the address they failed on, and that address carries the key.
 */
export const redactKey = (text: string, apiKey: string): string => text.split(apiKey).join('[key]')

/** The wait before retry number `attempt` (counted from 0): 1 s, 2 s, 4 s, then 8 s at most. */
export const backoffMilliseconds = (attempt: number): number =>
  Math.min(RATE_LIMIT_BACKOFF_START_MS * 2 ** attempt, RATE_LIMIT_BACKOFF_CAP_MS)

/**
 * Build the request address. The key is the last parameter and is never logged.
 */
export const buildRequestUrl = ({
  apiKey,
  chainId,
  endpoint,
  address,
}: EtherscanCallRequest & { apiKey: string }): string => {
  const { module, action, addressParameter } = ETHERSCAN_ENDPOINTS[endpoint]
  const parameters = new URLSearchParams({
    chainid: String(chainId),
    module,
    action,
    [addressParameter]: address,
    apikey: apiKey,
  })
  return `${ETHERSCAN_API_URL}?${parameters.toString()}`
}

/**
 * Create a client.
 *
 * Slots are reserved before the wait, so several callers at once are spread over time instead of
 * all waking together: the n-th concurrent caller waits n intervals. The interval is one second
 * divided by the lower of the plan's rate and the endpoint's own cap.
 */
export const createEtherscanClient = ({
  apiKey,
  callsPerSecond,
  fetchImplementation = fetch,
  sleep = defaultSleep,
  now = Date.now,
  signal,
}: EtherscanClientOptions): EtherscanClient => {
  let nextFreeSlot = 0

  const waitForSlot = async (endpoint: EtherscanEndpointName): Promise<void> => {
    const rate = Math.min(callsPerSecond, ETHERSCAN_ENDPOINTS[endpoint].maximumCallsPerSecond)
    const slot = Math.max(now(), nextFreeSlot)
    nextFreeSlot = slot + 1000 / rate
    const wait = slot - now()
    if (wait > 0) await sleep(wait, signal)
  }

  const attempt = async (request: EtherscanCallRequest): Promise<EtherscanCall> => {
    await waitForSlot(request.endpoint)
    try {
      const response = await fetchImplementation(buildRequestUrl({ ...request, apiKey }), { signal })
      if (response.status === 429) {
        return { classification: { outcome: 'rate-limited', detail: 'HTTP 429 Too Many Requests' }, result: null }
      }
      const body = (await response.json()) as { result?: unknown } | null
      return { classification: classifyEtherscanResponse(body), result: body?.result ?? null }
    } catch (error) {
      if (signal?.aborted) throw error
      const reason = redactKey(error instanceof Error ? error.message : String(error), apiKey)
      return { classification: { outcome: 'other', detail: `the request failed: ${reason}` }, result: null }
    }
  }

  const call = async (request: EtherscanCallRequest): Promise<EtherscanCall> => {
    let answer = await attempt(request)
    for (
      let retry = 0;
      retry < MAXIMUM_RATE_LIMIT_RETRIES && answer.classification.outcome === 'rate-limited';
      retry++
    ) {
      await sleep(backoffMilliseconds(retry), signal)
      answer = await attempt(request)
    }
    return answer
  }

  return { call }
}
