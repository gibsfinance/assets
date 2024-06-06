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
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, 15_000)
    controllers.push([timeoutId, controller])
    return fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      ...options,
    }).then((res) => {
      clearTimeout(timeoutId)
      return res
    })
  } else {
    throw new Error('unrecognized protocol')
  }
}

export {
  ipfsCompatableFetch as fetch
}
