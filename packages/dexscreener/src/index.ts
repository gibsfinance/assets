import { fetch, limitByTime } from '@gibs/utils/fetch'
import { type Chain, defineChain } from 'viem'
import * as chains from 'viem/chains'
import type * as dexscreenerSDK from 'dexscreener-sdk'
import promiseLimit from 'promise-limit'
import _ from 'lodash'

export type Website = { label: string; url: string }

export type Social = { type: string; url: string }

export type IInfo = Omit<dexscreenerSDK.IInfo, 'websites' | 'socials'> & {
  headerUrl?: string
  websites: Website[]
  socials: Social[]
}
export type IToken = dexscreenerSDK.IToken
export type TokenProfile = Omit<dexscreenerSDK.TokenProfile, 'websites' | 'socials'> & IInfo
export type TokenBoost = Omit<dexscreenerSDK.TokenBoost, 'websites' | 'socials'> & IInfo
export type Pair = Omit<dexscreenerSDK.Pair, 'info'> & {
  info: IInfo
}
export type TokenPairsResponse = Pair[]
export type PairsResponse = Omit<dexscreenerSDK.PairsResponse, 'pairs'> & {
  pairs: TokenPairsResponse
}
export type LatestDexSearch = Omit<dexscreenerSDK.PairsResponse, 'pairs'> & {
  pairs: TokenPairsResponse
}
// up to 64 requests in flight at the same time
const apiLimiter = promiseLimit<any>(64)

export const taskedTokenRequests = <T, A extends object>(
  perMinute: number,
  keys: (keyof A)[],
  fn: (a: { signal?: AbortSignal } & A) => Promise<T>,
) => {
  const cache = new Map<string, null | Promise<T>>()
  const minMs = Math.ceil(60_000 / perMinute)
  const rateLimiter = limitByTime(minMs)
  return (args?: { signal?: AbortSignal } & A) => {
    const a = args ?? ({} as A)
    const k = keys.map((k) => a[k]).join('-')
    const cached = cache.get(k)
    if (cached) {
      return cached
    }
    const promise = apiLimiter(async () => {
      await rateLimiter()
      const result = await fn(a)
      return result
    }).finally(() => {
      cache.delete(k)
    }) as Promise<T>
    cache.set(k, promise)
    return promise
  }
}
export const origin = new URL('https://api.dexscreener.com')
export const directFetchJSON = async <T>(url: URL, signal?: AbortSignal) => {
  return fetch(url, { signal }).then((res) => res.json() as Promise<T>)
}

export type ChainKey = `${string}-${string}`
export const chainKey = (chainId: string, tokenAddress: string) =>
  `${chainId}-${tokenAddress}`.toLowerCase() as ChainKey
export const dexscreenerApi = {
  getLatestTokenProfiles: taskedTokenRequests<TokenProfile[], {}>(60, [], ({ signal }) =>
    directFetchJSON<TokenProfile[]>(new URL('/token-profiles/latest/v1', origin), signal),
  ),
  getLatestTokenBoosts: taskedTokenRequests<TokenBoost[], {}>(60, [], ({ signal }) =>
    directFetchJSON<TokenBoost[]>(new URL('/token-boosts/latest/v1', origin), signal),
  ),
  getTopTokenBoosts: taskedTokenRequests<TokenBoost[], {}>(60, [], ({ signal }) =>
    directFetchJSON<TokenBoost[]>(new URL('/token-boosts/top/v1', origin), signal),
  ),
  getOrdersForToken: taskedTokenRequests<dexscreenerSDK.Order[], { chainId: string; tokenAddress: string }>(
    300,
    ['chainId', 'tokenAddress'],
    ({ signal, chainId, tokenAddress }) =>
      directFetchJSON<dexscreenerSDK.Order[]>(new URL(`/orders/v1/${chainId}/${tokenAddress}`, origin), signal),
  ),
  getPairById: taskedTokenRequests<PairsResponse, { chainId: string; pairId: string }>(
    300,
    ['chainId', 'pairId'],
    ({ signal, chainId, pairId }) =>
      directFetchJSON<PairsResponse>(new URL(`/latest/dex/pairs/${chainId}/${pairId}`, origin), signal),
  ),
  latestDexSearch: taskedTokenRequests<LatestDexSearch, { q: `${string}/${string}` }>(60, ['q'], ({ signal, q }) =>
    directFetchJSON<LatestDexSearch>(new URL(`/latest/dex/search?q=${q}`, origin), signal),
  ),
  tokenPairs: taskedTokenRequests<TokenPairsResponse, { chainId: string; tokenAddress: string }>(
    300,
    ['chainId', 'tokenAddress'],
    ({ signal, chainId, tokenAddress }) =>
      directFetchJSON<TokenPairsResponse>(new URL(`/token-pairs/v1/${chainId}/${tokenAddress}`, origin), signal),
  ),
  pairsByTokenAddresses: taskedTokenRequests<TokenPairsResponse, { chainId: string; tokenAddresses: string[] }>(
    300,
    ['chainId', 'tokenAddresses'],
    (
      (c) =>
      async ({ signal, chainId, tokenAddresses }) => {
        const [found, missing] = _.partition(tokenAddresses, (tokenAddress) => {
          const info = c.get(chainKey(chainId, tokenAddress))
          return info?.direct ?? false
        })
        if (!missing.length) {
          const resolvers = await Promise.all(
            _.map(found, (tokenAddress) => c.get(chainKey(chainId, tokenAddress))!.promise),
          )
          return _(resolvers)
            .map((r) => r())
            .flatten()
            .uniq()
            .value()
        }
        const createCache = (addr: string, direct: boolean = false) => {
          const k = chainKey(chainId, addr)
          if (c.has(k)) {
            return
          }
          let resolve!: (value: unknown) => void
          let list: TokenPairsResponse = []
          const promise = new Promise((res) => {
            resolve = res
          }).then(() => () => list)
          c.set(k, {
            direct,
            list,
            promise,
            resolve: (l) => {
              list.push(...l)
              list = _.uniqBy(list, (i) => i.pairAddress.toLowerCase())
              resolve(undefined)
            },
          })
        }
        for (const tokenAddress of missing) {
          createCache(tokenAddress, true)
        }
        const addrs = encodeURIComponent(tokenAddresses.join(','))
        const result = await directFetchJSON<TokenPairsResponse>(
          new URL(`/tokens/v1/${chainId}/${addrs}`, origin),
          signal,
        )
        const addTokenToList = (acc: Record<string, Pair[]>, pair: Pair, token: dexscreenerSDK.IToken) => {
          const key = chainKey(pair.chainId, token.address)
          acc[key] = acc[key] ?? []
          acc[key].push(pair)
        }
        const byKey = _.reduce(
          result,
          (acc, pair) => {
            addTokenToList(acc, pair, pair.baseToken)
            addTokenToList(acc, pair, pair.quoteToken)
            return acc
          },
          {} as Record<ChainKey, Pair[]>,
        )
        const tokenAddressesSet = new Set<string>(tokenAddresses.map((address) => address.toLowerCase()))
        for (const [key, pairs] of Object.entries(byKey)) {
          const k = key as ChainKey
          const addr = k.split('-')[1]
          if (!c.has(k)) {
            createCache(addr)
          }
          const info = c.get(k)!
          if (tokenAddressesSet.has(addr)) {
            info.direct = true
          }
          info!.resolve(pairs)
        }
        const resolvers = await Promise.all(tokenAddresses.map((address) => c.get(chainKey(chainId, address))!.promise))
        return _(resolvers)
          .map((r) => r())
          .flatten()
          .value()
      }
    )(
      new Map<
        ChainKey,
        {
          direct: boolean
          resolve: (response: TokenPairsResponse) => void
          promise: Promise<() => TokenPairsResponse>
          list: TokenPairsResponse
        }
      >(),
    ),
  ),
}

export type ChainType = 'evm' | 'solana' | 'tvm'

export const nameToKey = (name: string) => {
  return name.toLowerCase().split(' ').join('')
}

const evmChains = Object.entries(chains)
  .map(([name, chain]) => {
    return [nameToKey(name), { ...chain, type: 'evm' }] as const
  })
  // extra names
  .concat([
    ['ethereum', { ...chains.mainnet, type: 'evm' }],
    ['ethereumclassic', { ...chains.classic, type: 'evm' }],
    ['gnosischain', { ...chains.gnosis, type: 'evm' }],
    ['neonevm', { ...chains.neonMainnet, type: 'evm' }],
    ['core', { ...chains.coreDao, type: 'evm' }],
    ['degenchain', { ...chains.degen, type: 'evm' }],
    ['flowevm', { ...chains.flowMainnet, type: 'evm' }],
    ['stepnetwork', { ...chains.step, type: 'evm' }],
    ['energi', { ...chains.energy, type: 'evm' }],
    ['seiv2', { ...chains.sei, type: 'evm' }],
    ['conflux', { ...chains.confluxESpace, type: 'evm' }],
  ])

export const chainIdToChain = new Map<string, Chain & { type: ChainType }>([
  ...evmChains,
  [
    'solana',
    defineChain({
      id: 900,
      name: 'Solana',
      network: 'solana',
      type: 'solana',
      nativeCurrency: {
        name: 'Solana',
        symbol: 'SOL',
        decimals: 9,
      },
      rpcUrls: {
        default: {
          http: ['https://api.mainnet-beta.solana.com'],
          webSocket: ['wss://api.mainnet-beta.solana.com'],
        },
        public: {
          http: ['https://api.mainnet-beta.solana.com'],
          webSocket: ['wss://api.mainnet-beta.solana.com'],
        },
      },
    }),
  ],
  [
    'ton',
    defineChain({
      id: 1,
      name: 'Ton',
      network: 'ton',
      type: 'tvm',
      nativeCurrency: {
        name: 'Ton',
        symbol: 'TON',
        decimals: 9,
      },
      rpcUrls: {
        default: {
          http: ['https://rpc.ankr.com/http/ton_api_v2'],
        },
      },
    }),
  ],
])
