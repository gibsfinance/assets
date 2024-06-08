import * as utils from './utils'

const controllers: [NodeJS.Timeout, AbortController][] = []

export const cancelAllRequests = () => {
  for (const [id, controller] of controllers) {
    controller.abort()
    clearTimeout(id)
  }
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
  if (url.protocol?.startsWith('http')) {
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
  } else {
    throw new Error('unrecognized protocol')
  }
}

export { ipfsCompatableFetch as fetch }
