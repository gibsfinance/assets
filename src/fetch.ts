import * as utils from '@/utils'
import promiseLimit from 'promise-limit'
import { ipfs } from '@/args/ipfs'

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

const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const ipfsCompatableFetch = async (url: URL, options: Parameters<typeof fetch>[1]) => {
  const limiter = getLimiter(url)
  return await limiter(async () => {
    const controller = new AbortController()
    const timeout = utils.timeout(10_000)
    timeout.promise.then(() => {
      console.log('timeout %o', url.href)
      controller.abort()
    })
    const fetchOptions = {
      redirect: 'follow',
      signal: controller.signal,
      // used to get around certain domains that check user agents
      headers: {
        'User-Agent': userAgent,
      },
      ...options,
    } as const
    return fetch(url, fetchOptions).finally(() => {
      timeout.clear()
    })
  })
}

export const urlToPossibleLocations = (url: string | URL) => {
  const urls: URL[] = []
  url = new URL(url as string | URL)
  if (url.protocol === 'ipfs:') {
    const cid = url.origin && url.origin !== 'null' ? url.pathname.split('/')[1] : `${url.host}${url.pathname}`
    const ipfsDomains = ipfs().ipfs
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
      utils.failureLog(url.toString())
      throw new Error('unrecognized protocol')
    }
  }
  return urls
}

const iterativeIpfsCompatableFetch = async (url: string | URL, options?: Parameters<typeof fetch>[1]) => {
  const urls = urlToPossibleLocations(url)
  for (const url of urls) {
    try {
      return await ipfsCompatableFetch(url, options)
    } catch (err) {
      utils.failureLog(err)
    }
  }
  console.error('failed to fetch %o', url)
  throw new Error('failed to fetch')
}

export { iterativeIpfsCompatableFetch as fetch }
