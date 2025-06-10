import { ipfs } from './args/ipfs'
import { fetch as ipfsFetch } from '@gibs/utils/fetch'

/** use these ipfs origins when fetching ipfs:// content */
const ipfsDomains = ipfs().ipfs

/** add a user agent to bypass some server side blocking */
const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36'

/** fetch ipfs content just like fetch */
const iterativeIpfsCompatableFetch = async (url: string | URL, options?: Parameters<typeof fetch>[1]) => {
  const opts = {
    ...(options ?? {}),
    headers: {
      'User-Agent': userAgent,
      ...(options?.headers ?? {}),
    },
  }
  return await ipfsFetch(url, opts, ipfsDomains)
}

export { iterativeIpfsCompatableFetch as fetch }
