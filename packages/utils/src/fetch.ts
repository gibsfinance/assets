import _ from 'lodash'

import * as utils from './'
import promiseLimit from 'promise-limit'
import { failureLog } from './log'

export const responseToBuffer = async (res: Response) => {
  if (!res.ok) {
    return null
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.toString('utf-8').includes('window')) {
    throw new Error('redirected')
  }
  return buffer
}

export const limit = promiseLimit(16) as ReturnType<typeof promiseLimit<any>>

export const limitBy = _.memoize(<T extends unknown>(_key: string, count = 16) => {
  return promiseLimit<T>(count) as ReturnType<typeof promiseLimit<T>>
})

/**
 * Generic retry mechanism with exponential backoff
 */
const defaultRetryOpts = {
  delay: 10_000,
  attempts: 5,
}

export const retry = async <T>(fn: () => Promise<T>, options: Partial<typeof defaultRetryOpts> & { signal?: AbortSignal } = {}) => {
  const opts = {
    ...defaultRetryOpts,
    ...options,
  }
  let lastErr: Error | null = null
  do {
    if (opts.signal?.aborted) throw new Error('aborted')
    try {
      return await fn()
    } catch (err) {
      lastErr = err as Error
      failureLog(lastErr.message)
    }
    opts.attempts -= 1
    if (opts.attempts) {
      if (opts.signal?.aborted) throw new Error('aborted')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, opts.delay)
        opts.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve()
        }, { once: true })
      })
    }
  } while (opts.attempts)
  throw lastErr
}

/**
 * Result caching utility with a time-to-live window.
 *
 * The freshness check compares a stored timestamp against the current time.
 * Reading that time from `Date.now()` directly forces every consumer's test
 * to either wait out a real duration or reach into global fake timers to
 * prove the window ever closes. The clock is injectable so a test can supply
 * a fixed or stepped `now` instead, and assert "still fresh" and "now stale"
 * without depending on wall-clock speed.
 *
 * The returned function also carries `reset()`, which drops the memoized value so
 * the next call re-runs the worker. Without it the only way to pick up a change
 * inside the window is to restart the process, which is a poor way to confirm a
 * deploy actually took effect.
 */
export const cacheResult = <T>(
  worker: () => Promise<T>,
  duration = 1000 * 60 * 60,
  { now = Date.now }: { now?: () => number } = {},
) => {
  let cached: null | {
    timestamp: number
    result: Promise<T>
  } = null

  const read = _.wrap(worker, (fn) => {
    if (cached) {
      const { timestamp, result } = cached
      if (timestamp > now() - duration) {
        return result
      }
    }
    cached = {
      timestamp: now(),
      result: fn(),
    }
    return cached.result
  })

  // Object.assign keeps the wrapped call signature (and its inference) intact for
  // every existing call site, which only ever invokes the function itself.
  return Object.assign(read, {
    /** Discard the memoized value so the next call rebuilds it from the worker. */
    reset: () => {
      cached = null
    },
  })
}

/** @deprecated No-op — controller registration was removed. Retained for API compatibility. */
export const cancelAllRequests = () => {}

export const getLimiter = (url: URL): ReturnType<typeof promiseLimit<Response>> => {
  return utils.limitBy<Response>(url.host)
}

/** Default pause: a real `setTimeout`, resolving once the requested duration has elapsed. */
const waitRealTime = (duration: number) => new Promise<void>((resolve) => setTimeout(resolve, duration))

/**
 * Throttles calls so at least `ms` elapses between the end of one call and
 * the start of the next.
 *
 * Both the clock and the pause mechanism are injectable. Reading the clock
 * from `Date.now()` alone would still leave a test waiting out `ms` on the
 * real `setTimeout`, or reaching into global fake timers, to prove the
 * spacing is correct. Injecting `wait` lets a test observe the exact
 * duration the throttle asks for and resolve it immediately, while the
 * injected `now` supplies the elapsed time that produced that duration —
 * together they let a test assert the spacing logic itself, with no
 * dependency on wall-clock speed.
 */
export const limitByTime = (
  ms: number,
  { now = Date.now, wait = waitRealTime }: { now?: () => number; wait?: (duration: number) => Promise<void> } = {},
) => {
  let last = 0
  const limiter = promiseLimit(1)
  return async () => {
    return limiter(async () => {
      const currentTime = now()
      const waitTime = last + ms - currentTime
      if (waitTime > 0) {
        await wait(waitTime)
      }
      last = now()
    })
  }
}

const ipfsCompatableFetch = async (url: URL, options: Parameters<typeof fetch>[1]) => {
  const limiter = getLimiter(url)
  const signal = options?.signal
  const limiterPromise = limiter(async () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const timeoutSignal = AbortSignal.timeout(10_000)
    const anyAborted = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    const fetchOptions = {
      redirect: 'follow',
      signal: anyAborted,
      ...options,
    } as const
    return fetch(url, fetchOptions)
  })
  if (!signal) return limiterPromise
  return Promise.race([
    limiterPromise,
    new Promise<never>((_, reject) => {
      if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }),
  ])
}

export const urlToPossibleLocations = (url: string | URL, ipfsDomains: string[]) => {
  const urls: URL[] = []
  url = new URL(url as string | URL)
  if (url.protocol === 'ipfs:') {
    // Non-standard protocols (ipfs:) always have opaque origin ('null' per URL spec)
    const cid = `${url.host}${url.pathname}`
    // load balance across ipfs domains
    for (const domain of ipfsDomains) {
      urls.push(new URL(`${domain}${cid}`))
    }
  } else {
    urls.push(url)
  }
  for (const url of urls) {
    // support both http+https
    if (!url.protocol?.startsWith('http')) {
      failureLog(url.toString())
      throw new Error('unrecognized protocol')
    }
  }
  return urls
}

const iterativeIpfsCompatableFetch = async (
  url: string | URL,
  options?: Parameters<typeof fetch>[1],
  ipfsDomains: string[] = [],
) => {
  let lastErr: Error | null = null
  const urls = urlToPossibleLocations(url, ipfsDomains)
  for (const url of urls) {
    try {
      return await ipfsCompatableFetch(url, options)
    } catch (err) {
      lastErr = err as Error
      failureLog(lastErr.message)
    }
  }
  throw lastErr
}

export { iterativeIpfsCompatableFetch as fetch }
