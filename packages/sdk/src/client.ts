import { getImageUrl, getNetworkImageUrl, type ImageOptions } from './image'
import { getTokenListUrl, getNetworksUrl, getListIndexUrl } from './list'
import type { TokenList, NetworkInfo, ListInfo } from './types'

export interface GibClientOptions {
  /** Base URL of the Gib.Show API */
  baseUrl?: string
  /** Use staging server */
  staging?: boolean
}

export interface GibClient {
  /** Get the full URL for a token image */
  imageUrl(chainId: number, address: string, options?: ImageOptions): string
  /** Get the full URL for a network/chain image */
  networkImageUrl(chainId: number, options?: ImageOptions): string
  /** Fetch a token list */
  fetchTokenList(provider: string, key: string, chainId?: number): Promise<TokenList>
  /** Fetch all supported networks */
  fetchNetworks(): Promise<NetworkInfo[]>
  /** Fetch all available lists */
  fetchLists(): Promise<ListInfo[]>
  /** The resolved base URL */
  baseUrl: string
}

const PRODUCTION_URL = 'https://gib.show'
const STAGING_URL = 'https://staging.gib.show'

export function createClient(options: GibClientOptions = {}): GibClient {
  const baseUrl = options.baseUrl || (options.staging ? STAGING_URL : PRODUCTION_URL)

  return {
    baseUrl,

    imageUrl(chainId: number, address: string, imgOptions?: ImageOptions): string {
      return getImageUrl(baseUrl, chainId, address, imgOptions)
    },

    networkImageUrl(chainId: number, imgOptions?: ImageOptions): string {
      return getNetworkImageUrl(baseUrl, chainId, imgOptions)
    },

    async fetchTokenList(provider: string, key: string, chainId?: number): Promise<TokenList> {
      const url = getTokenListUrl(baseUrl, provider, key, chainId)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to fetch list: ${res.status}`)
      return res.json()
    },

    async fetchNetworks(): Promise<NetworkInfo[]> {
      const url = getNetworksUrl(baseUrl)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to fetch networks: ${res.status}`)
      return res.json()
    },

    async fetchLists(): Promise<ListInfo[]> {
      const url = getListIndexUrl(baseUrl)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to fetch lists: ${res.status}`)
      return res.json()
    },
  }
}
