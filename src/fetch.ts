import * as utils from './utils'
import promiseLimit from 'promise-limit'
import { collect } from '@/args'

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

let ipfsCounter = 0

const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const ipfsCompatableFetch: typeof fetch = async (
  url: Parameters<typeof fetch>[0],
  options: Parameters<typeof fetch>[1],
) => {
  url = new URL(url as string | URL)
  if (url.protocol === 'ipfs:') {
    const cid = url.origin && url.origin !== 'null' ? url.pathname.split('/')[1] : `${url.host}${url.pathname}`
    const ipfsDomains = collect().ipfs
    // load balance across ipfs domains
    const domain = ipfsDomains[ipfsCounter % ipfsDomains.length]
    ipfsCounter++
    url = new URL(`${domain}${cid}`)
  }
  // support both http+https
  if (url.protocol?.startsWith('http')) {
    const limiter = getLimiter(url)
    return await limiter(async () => {
      const controller = new AbortController()
      const timeout = utils.timeout(3_000)
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
  } else {
    utils.failureLog(url.toString())
    throw new Error('unrecognized protocol')
  }
}

export { ipfsCompatableFetch as fetch }
