/**
 * @module image-store/http
 * What the remote adapters share for talking to a storage service over HTTP: the error they
 * throw, a retry for answers worth repeating, and the settings that let a test replace the
 * network and the clock.
 */
import { log } from '../logger'

/** The `fetch` function the adapters call. Tests pass a fake; production uses the global one. */
export type FetchFunction = (input: string | URL, init?: RequestInit) => Promise<Response>

/** Settings every remote adapter takes, so tests can control the network, the clock and the waiting. */
export type RemoteStoreEnvironment = {
  /** Defaults to the global `fetch`. */
  fetch?: FetchFunction
  /** Clock in milliseconds. Defaults to `Date.now`. */
  now?: () => number
  /** How many more times a request is tried after a throttled or failed answer. Defaults to 2. */
  retries?: number
  /** Waits for a number of milliseconds. Defaults to a timer. Tests pass a fake. */
  sleep?: (milliseconds: number) => Promise<void>
  /** Entries a listing page asks for. Defaults to 1000, the most S3 and Azure answer with. */
  pageSize?: number
}

/** Default for {@link RemoteStoreEnvironment.retries}. */
export const DEFAULT_RETRIES = 2

/** Default for {@link RemoteStoreEnvironment.pageSize}. */
export const DEFAULT_PAGE_SIZE = 1000

/** Wait before the first retry. Each later retry waits twice as long as the one before. */
export const RETRY_BASE_DELAY_MS = 250

/**
 * A storage service refused a request, or answered with something that cannot be used.
 *
 * The message names the operation and the status, never the request headers, so a credential
 * cannot reach a log line through it.
 */
export class BlobStoreError extends Error {
  /** HTTP status of the answer, when there was one. */
  readonly status: number | undefined

  /**
   * @param message What failed, in plain words.
   * @param status HTTP status of the answer, when there was one.
   * @param options The underlying error, kept as `cause`.
   */
  constructor(message: string, status?: number, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'BlobStoreError'
    this.status = status
  }
}

/** Answers worth asking again: throttling and server-side failures. */
const isRetryable = (status: number): boolean => status === 429 || status >= 500

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds))

/**
 * Sends a request, asking again after a network failure, a 429 or a 5xx answer.
 *
 * Retrying is safe here because every request an adapter sends is idempotent: blobs are named
 * by their content, so a repeated write stores the same bytes under the same name.
 *
 * @param send Builds and sends the request. It runs again for each attempt, so a signed request
 *   gets a fresh signature and date every time.
 * @param environment Retry count and sleep.
 * @returns The first answer that is not retryable, or the last answer once retries run out.
 * @throws The last network error when every attempt failed without an answer.
 */
export async function sendWithRetry(
  send: () => Promise<Response>,
  environment: Pick<RemoteStoreEnvironment, 'retries' | 'sleep'> = {},
): Promise<Response> {
  const { retries = DEFAULT_RETRIES, sleep = wait } = environment
  for (let attempt = 0; ; attempt += 1) {
    const isLastAttempt = attempt >= retries
    let response: Response
    try {
      response = await send()
    } catch (error) {
      if (isLastAttempt) throw error
      log('image store: request failed, trying again: %o', error)
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
      continue
    }
    if (isLastAttempt || !isRetryable(response.status)) return response
    await response.body?.cancel()
    await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
  }
}

/**
 * Throws a {@link BlobStoreError} unless the answer's status is one of the expected ones.
 *
 * @param response The answer.
 * @param operation What was asked, for the message, for example `s3 put`.
 * @param accepted Statuses that mean success.
 * @returns The same answer.
 */
export async function expectStatus(
  response: Response,
  operation: string,
  accepted: readonly number[] = [200],
): Promise<Response> {
  if (accepted.includes(response.status)) return response
  const detail = (await response.text().catch(() => '')).slice(0, 300)
  throw new BlobStoreError(
    `${operation} failed with status ${response.status}${detail ? `: ${detail}` : ''}`,
    response.status,
  )
}

/**
 * The bytes of an answer's body.
 *
 * @param response The answer.
 */
export const readBytes = async (response: Response): Promise<Buffer> => Buffer.from(await response.arrayBuffer())

/**
 * A modification time from an HTTP header or a JSON field.
 *
 * @param text An HTTP date or an ISO 8601 timestamp.
 * @param operation What was asked, for the message.
 * @returns Milliseconds since the epoch.
 * @throws BlobStoreError when the text is not a date: a store that cannot say how old a blob is
 *   would let `images gc` guess, so it is refused.
 */
export function parseModifiedAt(text: string | null | undefined, operation: string): number {
  const milliseconds = Date.parse(text ?? '')
  if (Number.isNaN(milliseconds)) throw new BlobStoreError(`${operation}: the answer has no usable modification time`)
  return milliseconds
}
