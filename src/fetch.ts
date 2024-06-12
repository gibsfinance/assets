import * as utils from './utils'
import promiseLimit from 'promise-limit'

const controllers: [NodeJS.Timeout, AbortController][] = []

export const cancelAllRequests = () => {
  for (const [id, controller] of controllers) {
    controller.abort()
    clearTimeout(id)
  }
}

const limiters = new Map<string, ReturnType<typeof promiseLimit<Response>>>()

export const getLimiter = (url: URL) => {
  let limiter = limiters.get(url.host)
  if (limiter) return limiter
  limiter = promiseLimit(16)
  limiters.set(url.host, limiter)
  return limiter
}

const ipfsCompatableFetch: typeof fetch = async (
  url: Parameters<typeof fetch>[0],
  options: Parameters<typeof fetch>[1],
) => {
  url = new URL(url as string | URL)
  if (url.protocol === 'ipfs:') {
    const cid = url.origin && url.origin !== 'null' ? url.pathname.split('/')[1] : url.host
    url = new URL(`https://ipfs.io/ipfs/${cid}`)
  }
  if (url.protocol.startsWith('hhttp')) {
    url.protocol = url.protocol.slice(1)
  }
  // support both http+https
  if (url.protocol?.startsWith('http')) {
    const limiter = getLimiter(url)
    return await limiter(async () => {
      const controller = new AbortController()
      const timeout = utils.timeout(15_000)
      controllers.push([timeout.timeoutId(), controller])
      return fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        ...options,
      }).then((res) => {
        clearTimeout(timeout.timeoutId())
        return res
      }).catch((err) => {
        clearTimeout(timeout.timeoutId())
        throw err
      })
    })
  } else {
    utils.failureLog(url.toString())
    throw new Error('unrecognized protocol')
  }
}

export { ipfsCompatableFetch as fetch }
