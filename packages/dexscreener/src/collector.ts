import _ from 'lodash'
import { ChainType, IInfo, Website, Social, chainIdToChain, TokenPairsResponse, dexscreenerApi, IToken } from '.'
import type * as dexscreenerSDK from 'dexscreener-sdk'
import { createPublicClient, http, erc20Abi, erc20Abi_bytes32, type Hex } from 'viem'
import { MinimalTokenInfoWithLogo, retry } from '@gibs/utils'
export type UpdateKey = 'token' | 'pair'

export type TokenKey = `${ChainType}-${number}-${string}`

export class Collector {
  constructor(
    protected chainKey: string,
    protected chainType: ChainType,
    protected chainId: number,
    protected signal: AbortSignal,
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
  setToken(token: IToken) {
    const key = this.toKey(token.address)
    const existing = this.token.get(key)
    if (existing) {
      return false
    }
    this.token.set(key, token)
    return true
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
  async tokenPairs(token: string, signal?: AbortSignal) {
    const pairs = await retry(() =>
      dexscreenerApi.tokenPairs({
        chainId: this.chainKey,
        tokenAddress: token,
        signal,
      }),
    )
    return pairs
  }
  async collect(tokens: Set<string>, signal?: AbortSignal) {
    const matchingTokensPairsDeep: TokenPairsResponse[] = []
    for (const token of tokens.values()) {
      const pairs = await this.tokenPairs(token, signal)
      matchingTokensPairsDeep.push(pairs)
    }
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
  toTokenLists() {
    const list = [...this.token.values()].reduce(
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
    return list
  }
}
