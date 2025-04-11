import { Chain, createPublicClient, defineChain, http, erc20Abi, type Hex, erc20Abi_bytes32, getAddress } from 'viem'
import * as fs from 'fs'
import * as path from 'path'
import * as cheerio from 'cheerio'
import * as chains from 'viem/chains'
import * as dexscreenerSDK from 'dexscreener-sdk'
import promiseLimit from 'promise-limit'
import _ from 'lodash'

import { fetch, limitByTime } from '@/fetch'
import * as db from '@/db'
import * as utils from '@/utils'
import { MinimalTokenInfo, MinimalTokenInfoWithLogo } from '@/types'
import type { Link, ListToken, Network } from 'knex/types/tables.js'
import { failureLog } from '../utils'

type ChainInfo = {
  name: string
  url: string
}

type Website = { label: string; url: string }

type Social = { type: string; url: string }

type IInfo = Omit<dexscreenerSDK.IInfo, 'websites' | 'socials'> & {
  headerUrl?: string
  websites: Website[]
  socials: Social[]
}
type TokenProfile = Omit<dexscreenerSDK.TokenProfile, 'websites' | 'socials'> & IInfo
type TokenBoost = Omit<dexscreenerSDK.TokenBoost, 'websites' | 'socials'> & IInfo
type Pair = Omit<dexscreenerSDK.Pair, 'info'> & {
  info: IInfo
}
type TokenPairsResponse = Pair[]
type PairsResponse = Omit<dexscreenerSDK.PairsResponse, 'pairs'> & {
  pairs: TokenPairsResponse
}
type LatestDexSearch = Omit<dexscreenerSDK.PairsResponse, 'pairs'> & {
  pairs: TokenPairsResponse
}
// up to 64 requests in flight at the same time
const apiLimiter = promiseLimit<any>(64)

const taskedTokenRequests = <T, A extends unknown[]>(perMinute: number, fn: (...a: A) => Promise<T>) => {
  const cache = new Map<string, null | Promise<T>>()
  const minMs = Math.ceil(60_000 / perMinute)
  const rateLimiter = limitByTime(minMs)
  // const apiLimiter = promiseLimit<any>(64)
  return (...args: A) => {
    const k = args.join('-')
    const cached = cache.get(k)
    if (cached) {
      return cached
    }
    const promise = apiLimiter(async () => {
      await rateLimiter()
      const result = await fn(...args)
      return result
    })
      .catch((e) => {
        console.log(args)
        throw e
      })
      .finally(() => {
        cache.delete(k)
      }) as Promise<T>
    cache.set(k, promise)
    return promise
  }
}
const origin = new URL('https://api.dexscreener.com')
const directFetchJSON = async <T>(url: URL) => {
  return fetch(url).then((res) => res.json() as Promise<T>)
}

type ChainKey = `${string}-${string}`
const chainKey = (chainId: string, tokenAddress: string) => `${chainId}-${tokenAddress}`.toLowerCase() as ChainKey
const dexscreenerApi = {
  getLatestTokenProfiles: taskedTokenRequests<TokenProfile[], []>(60, () =>
    directFetchJSON<TokenProfile[]>(new URL('/token-profiles/latest/v1', origin)),
  ),
  getLatestTokenBoosts: taskedTokenRequests<TokenBoost[], []>(60, () =>
    directFetchJSON<TokenBoost[]>(new URL('/token-boosts/latest/v1', origin)),
  ),
  getTopTokenBoosts: taskedTokenRequests<TokenBoost[], []>(60, () =>
    directFetchJSON<TokenBoost[]>(new URL('/token-boosts/top/v1', origin)),
  ),
  getOrdersForToken: taskedTokenRequests<dexscreenerSDK.Order[], [string, string]>(300, (chainId, tokenAddress) =>
    directFetchJSON<dexscreenerSDK.Order[]>(new URL(`/orders/v1/${chainId}/${tokenAddress}`, origin)),
  ),
  getPairById: taskedTokenRequests<PairsResponse, [string, string]>(300, (chainId, pairId) =>
    directFetchJSON<PairsResponse>(new URL(`/latest/dex/pairs/${chainId}/${pairId}`, origin)),
  ),
  latestDexSearch: taskedTokenRequests<LatestDexSearch, [`${string}/${string}`]>(60, (q) =>
    directFetchJSON<LatestDexSearch>(new URL(`/latest/dex/search?q=${q}`, origin)),
  ),
  tokenPairs: taskedTokenRequests<TokenPairsResponse, [string, string]>(300, (chainId, tokenAddress) =>
    directFetchJSON<TokenPairsResponse>(new URL(`/token-pairs/v1/${chainId}/${tokenAddress}`, origin)),
  ),
  pairsByTokenAddresses: taskedTokenRequests<TokenPairsResponse, [string, string[]]>(
    300,
    ((c) => async (chainId, tokenAddresses) => {
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
      const result = await directFetchJSON<TokenPairsResponse>(new URL(`/tokens/v1/${chainId}/${addrs}`, origin))
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
    })(
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

type ChainType = 'evm' | 'solana' | 'tvm'

const nameToKey = (name: string) => {
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

const chainIdToChain = new Map<string, Chain & { type: ChainType }>([
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

type TokenKey = `${ChainType}-${number}-${string}`

const parseSidebarChainInfo = () => {
  const file = path.join(process.cwd(), 'src', 'harvested', 'dexscreener', 'chain-sidebar.html')
  const html = fs.readFileSync(file, 'utf8')
  const $ = cheerio.load(html)
  const chainInfo = new Map<string, ChainInfo>()
  $('.ds-nav-link').each((i, el) => {
    const img = $('img', el)
    const chainName = img.attr('alt')
    const chainImage = img.attr('src')
    if (chainName && chainImage) {
      const key = nameToKey(chainName)
      chainInfo.set(key, { name: chainName, url: chainImage })
    }
  })
  return chainInfo
}

class Collector {
  constructor(
    protected chainKey: string,
    protected chainType: ChainType,
    protected chainId: number,
  ) {}
  pending = new Set<TokenKey>()
  fetched = new Set<TokenKey>()
  token = new Map<TokenKey, dexscreenerSDK.IToken>()
  info = new Map<TokenKey, IInfo | false>() // any known logo uri will exist here
  decimals = new Map<TokenKey, number>() // this will need to be fetched somehow
  toKey(address: string) {
    return `${this.chainType}-${this.chainId}-${address.toLowerCase()}` as const
  }
  markTokenAsPending(address: string) {
    const tokenId = this.toKey(address)
    if (this.pending.has(tokenId) || this.fetched.has(tokenId)) {
      return
    }
    this.pending.add(tokenId)
  }
  markTokenAsFetched(addresses: Set<string>) {
    for (const address of addresses.values()) {
      const key = this.toKey(address)
      this.fetched.add(key)
      this.pending.delete(key)
    }
  }
  getPendingTokens(limit: number) {
    const pending: Set<string> = new Set()
    for (const tokenId of this.pending.values()) {
      const address = tokenId.split('-')[2]
      pending.add(address)
      if (pending.size >= limit) {
        return pending
      }
    }
    return pending
  }
  setToken(token: dexscreenerSDK.IToken) {
    const key = this.toKey(token.address)
    const existing = this.token.get(key)
    if (existing) {
      return
    }
    this.token.set(key, token)
  }
  setInfo(address: string, info: IInfo) {
    const key = this.toKey(address)
    const existing = this.info.get(key) || info
    for (const [key, value] of Object.entries(info)) {
      if (key === 'imageUrl') {
        if (typeof value === 'string' && !_.isEqual(value, existing.imageUrl)) {
          existing.imageUrl = value
        }
      } else if (key === 'websites') {
        if (Array.isArray(value)) {
          existing.websites = _.uniqBy(value.concat(existing.websites ?? []), 'url') as Website[]
        }
      } else if (key === 'socials') {
        if (Array.isArray(value)) {
          existing.socials = _.uniqBy(value.concat(existing.socials ?? []), 'type') as Social[]
        }
      }
    }
    this.info.set(key, existing)
  }
  markTokenInfoAsMissing(address: string) {
    const key = this.toKey(address)
    if (this.info.has(key)) {
      return
    }
    this.info.set(key, false)
  }
  async collectDecimals(tokens: Set<string>) {
    const chain = chainIdToChain.get(this.chainKey)
    if (!chain) {
      return
    }
    const client = createPublicClient({
      chain,
      transport: http(chain.rpcUrls.default.http[0]),
    })
    const tokenList = [...tokens.values()]
    const decimals = await client.multicall({
      contracts: tokenList.map((token) => ({
        abi: erc20Abi,
        address: token as Hex,
        functionName: 'decimals',
        args: [],
      })),
      allowFailure: true,
    })
    const missing = []
    for (let i = 0; i < tokenList.length; i++) {
      const { result, status } = decimals[i]
      if (status !== 'success') {
        missing.push(tokenList[i])
        continue
      }
      const decimal = Number(result.toString())
      const key = this.toKey(tokenList[i])
      this.decimals.set(key, decimal)
    }

    const decimalsBytes32 = await client.multicall({
      contracts: missing.map((token) => ({
        abi: erc20Abi_bytes32,
        address: token as Hex,
        functionName: 'decimals',
        args: [],
      })),
      allowFailure: true,
    })
    for (let i = 0; i < missing.length; i++) {
      const { result, status } = decimalsBytes32[i]
      if (status !== 'success') {
        if (this.decimals.has(this.toKey(missing[i]))) {
          continue
        }
        this.decimals.set(this.toKey(missing[i]), 0)
        continue
      }
      const decimal = Number(result.toString())
      this.decimals.set(this.toKey(missing[i]), decimal)
    }
  }
  async collect(tokens: Set<string>) {
    const matchingTokensPairsDeep = await utils.limit.map(
      [...tokens.values()],
      async (token): Promise<TokenPairsResponse> => {
        return dexscreenerApi.tokenPairs(this.chainKey, token)
      },
    )
    const pairs = _.flatten(matchingTokensPairsDeep)
    if (!pairs.length) {
      return
    }
    pairs.forEach((pair) => {
      if (pair.info?.imageUrl) {
        this.setInfo(pair.baseToken.address, pair.info as unknown as IInfo)
      } else {
        this.markTokenInfoAsMissing(pair.quoteToken.address)
      }
      this.setToken(pair.quoteToken)
      this.setToken(pair.baseToken)
      this.markTokenAsPending(pair.quoteToken.address)
      this.markTokenAsPending(pair.baseToken.address)
    })
    this.markTokenAsFetched(tokens)
  }
  updateStatus() {
    const p = this.pending.size
    const f = this.fetched.size
    const t = p + f
    const i = this.info.size
    utils.updateStatus(`📥 dexscreener collecting ${this.chainKey} pending=${p} fetched=${f} total=${t} info=${i}`)
  }
  toTokenLists() {
    return [...this.token.values()].reduce(
      (acc, token) => {
        const info = this.info.get(this.toKey(token.address))
        const decimal = this.decimals.get(this.toKey(token.address)) ?? 0
        acc[0].push({
          ...token,
          decimals: decimal,
          logoURI: (info && info.imageUrl) || null,
        })
        if (info && info.headerUrl) {
          acc[1].push([token.address.toLowerCase(), info.headerUrl])
        }
        return acc
      },
      [[], []] as [MinimalTokenInfoWithLogo[], [string, string][]],
    )
  }
}

// const collector = new Collector()

export const collect = async () => {
  const [provider] = await db.insertProvider({
    key: 'dexscreener',
    name: 'DexScreener',
  })
  const allNetworksId = utils.chainIdToNetworkId(0)
  const [listOfAllTokens] = await db.insertList({
    providerId: provider.providerId,
    networkId: allNetworksId,
    key: 'dexscreener',
    name: 'DexScreener',
  })
  const [listOfBoostedTokens] = await db.insertList({
    providerId: provider.providerId,
    networkId: allNetworksId,
    key: 'dexscreener-boosted',
    name: 'DexScreener Boosted',
  })
  const [latestProfiles, latestBoosted, topBoosted] = await Promise.all([
    dexscreenerApi.getLatestTokenProfiles(),
    dexscreenerApi.getLatestTokenBoosts(),
    dexscreenerApi.getTopTokenBoosts(),
  ])
  const allChainIds = new Set<string>()
  latestProfiles.forEach((profile) => {
    allChainIds.add(profile.chainId)
  })
  latestBoosted.forEach((boost) => {
    allChainIds.add(boost.chainId)
  })
  topBoosted.forEach((boost) => {
    allChainIds.add(boost.chainId)
  })
  const parsedChainInfo = parseSidebarChainInfo()
  ;[...parsedChainInfo.keys()].forEach((key) => {
    allChainIds.add(key)
  })
  utils.updateStatus(`dexscreener found ${allChainIds.size} chains`)
  const chainBlacklist = new Set<string>()
  for (const chainId of allChainIds.values()) {
    const chain = chainIdToChain.get(chainId)
    if (!chain) {
      chainBlacklist.add(chainId)
      continue
    }
  }
  utils.updateStatus(`dexscreener blacklisted ${chainBlacklist.size} chains`)
  await utils.limit.map([...parsedChainInfo.entries()], async ([key, info]) => {
    const chain = chainIdToChain.get(key)
    if (!chain) {
      return
    }
    const url = new URL(info.url)
    const image = await fetch(url).then(utils.responseToBuffer)
    await db.transaction(async (tx) => {
      const network = await db.insertNetworkFromChainId(chain.id, chain.type, tx)
      await db.fetchImageAndStoreForNetwork(
        {
          network,
          uri: image ?? url.href,
          originalUri: url.href,
          providerKey: provider.providerId,
        },
        tx,
      )
    })
  })

  const nativeTokens = new Map<ChainType | `${ChainType}-${number}`, string[]>([
    ['evm-369', ['0xA1077a294dDE1B09bB078844df40758a5D0f9a27']],
    ['evm-1', ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2']],
    ['solana', ['So11111111111111111111111111111111111111112']],
  ])
  const relevantChains = [...chainIdToChain.entries()].filter(([key, chain]) => {
    return key === 'pulsechain' || key === 'ethereum'
  })
  await Promise.all(
    relevantChains.map(async ([key, chain]) => {
      const filter = {
        type: chain.type,
        chainId: chain.id.toString(),
      }
      const network = await db.getNetworks().where(filter).first<Network>()
      const startingTokens = (nativeTokens.get(`${chain.type}-${chain.id}`) ?? nativeTokens.get(chain.type))!
      const collector = new Collector(key, chain.type, chain.id)
      for (const token of startingTokens) {
        collector.markTokenAsPending(token)
      }
      let nextKeys: Set<string> = new Set()
      while ((nextKeys = collector.getPendingTokens(16)).size) {
        await Promise.all([collector.collect(nextKeys), collector.collectDecimals(nextKeys)])
        collector.updateStatus()
      }
      const [all, header] = collector.toTokenLists()
      const addressToHeaderUri = new Map<string, string>(header)
      for (let i = 0; i < all.length; i++) {
        const token = all[i]
        utils.updateStatus(`💾 [dexscreener] total=${all.length} address=${token.address} progress=${i}`)
        const { listToken } = await db.fetchImageAndStoreForToken({
          listId: listOfAllTokens.listId,
          providerKey: provider.providerId,
          uri: token.logoURI ?? null,
          originalUri: token.logoURI ?? null,
          token: {
            type: 'erc20',
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            networkId: network.networkId,
            providedId: token.address,
          },
        })
        const headerUri = addressToHeaderUri.get(token.address.toLowerCase())
        if (!headerUri) continue
        await db
          .fetchAndInsertHeader({
            uri: headerUri,
            originalUri: headerUri,
            listTokenId: listToken.listTokenId,
            providerKey: provider.providerId,
          })
          .catch((e) => {
            console.log('failed at header fetch', headerUri, e)
            throw e
          })
      }
    }),
  )
}
// at this point, we can confidently say that all of the chains are supported by the config above
