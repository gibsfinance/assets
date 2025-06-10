import _ from 'lodash'

import * as utils from './'
import promiseLimit from 'promise-limit'
import { timeout } from './timeout'
import { failureLog } from './log'

export const responseToBuffer = async (res: Response) => {
  if (!res.ok) {
    return null
  }
  const text = await res.text()
  if (text.includes('window')) {
    throw new Error('redirected')
  }
  return Buffer.from(await res.arrayBuffer())
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

export const retry = async <T>(fn: () => Promise<T>, options = {}) => {
  const opts = {
    ...defaultRetryOpts,
    ...options,
  }
  let lastErr: Error | null = null
  do {
    try {
      return await fn()
    } catch (err) {
      lastErr = err as Error
      failureLog(lastErr.message)
    }
    opts.attempts -= 1
    if (opts.attempts) {
      await timeout(opts.delay).promise
    }
  } while (opts.attempts)
  throw lastErr
}

/**
 * Result caching utility with TTL
 */
export const cacheResult = <T>(worker: () => Promise<T>, duration = 1000 * 60 * 60) => {
  let cached: null | {
    timestamp: number
    result: Promise<T>
  } = null

  return _.wrap(worker, (fn) => {
    if (cached) {
      const { timestamp, result } = cached
      if (timestamp > Date.now() - duration) {
        return result
      }
    }
    cached = {
      timestamp: Date.now(),
      result: fn(),
    }
    return cached.result
  })
}

const controllers: [NodeJS.Timeout, AbortController][] = []

export const cancelAllRequests = () => {
  for (const [id, controller] of controllers) {
    controller.abort()
    clearTimeout(id)
  }
}

export const getLimiter = (url: URL): ReturnType<typeof promiseLimit<Response>> => {
  return utils.limitBy<Response>(url.host)
}

export const limitByTime = (ms: number) => {
  let last = 0
  const limiter = promiseLimit(1)
  return async () => {
    return limiter(async () => {
      const now = Date.now()
      const waitTime = last + ms - now
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime))
      }
      last = Date.now()
    })
  }
}

const ipfsCompatableFetch = async (url: URL, options: Parameters<typeof fetch>[1]) => {
  const limiter = getLimiter(url)
  return await limiter(async () => {
    const timeoutSignal = AbortSignal.timeout(10_000)
    const anyAborted = options && options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
    const fetchOptions = {
      redirect: 'follow',
      signal: anyAborted,
      // used to get around certain domains that check user agents
      ...options,
    } as const
    return fetch(url, fetchOptions)
  })
}

export const urlToPossibleLocations = (url: string | URL, ipfsDomains: string[]) => {
  const urls: URL[] = []
  url = new URL(url as string | URL)
  if (url.protocol === 'ipfs:') {
    const cid = url.origin && url.origin !== 'null' ? url.pathname.split('/')[1] : `${url.host}${url.pathname}`
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
