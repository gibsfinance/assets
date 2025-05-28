import * as fs from 'fs'
import * as path from 'path'
import * as cheerio from 'cheerio'
import { limitBy, responseToBuffer } from '@gibs/utils/fetch'
import { chainIdToChain, type ChainType, dexscreenerApi, type IInfo, type IToken, nameToKey } from '@gibs/dexscreener'
import { Collector } from '@gibs/dexscreener/collector'

import { fetch } from '../fetch'
import * as db from '../db'
import * as utils from '../utils'
import type { Network } from 'knex/types/tables.js'
import { terminalCounterTypes, terminalLogTypes, TerminalRowProxy, terminalRowTypes } from '../log/types'

const providerKey = 'dexscreener'

type ChainInfo = {
  name: string
  url: string
}

class TerminalLinkedCollector extends Collector {
  protected infoCheck = new Set<string>()
  constructor(
    protected chainKey: string,
    protected chainType: ChainType,
    protected chainId: number,
    protected row: TerminalRowProxy,
  ) {
    super(chainKey, chainType, chainId)
  }
  setInfo(address: string, info: IInfo) {
    super.setInfo(address, info)
    if (!this.infoCheck.has(address)) {
      this.infoCheck.add(address)
      this.row.increment('image', new Set([address]))
    }
  }
  setToken(token: IToken) {
    const result = super.setToken(token)
    if (result) {
      this.row.incrementTotal(terminalCounterTypes.TOKEN, `${this.chainId}-${token.address.toLowerCase()}`)
    }
    return result
  }
  async tokenPairs(token: string) {
    const section = this.row.get(providerKey)!
    const chainTokenId = utils.counterId.token([this.chainId, token])
    const task = section.task(chainTokenId, {
      type: terminalRowTypes.STORAGE,
      id: 'pairs',
      kv: {
        type: this.chainType,
        address: token,
        key: this.chainKey,
        id: this.chainId.toString(),
      },
    })
    // should always finish within 200ms (rate limit)
    const pairs = await super.tokenPairs(token)
    this.row.increment(terminalCounterTypes.TOKEN, chainTokenId)
    task.complete()
    return pairs
  }
}

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

export const collect = async (signal?: AbortSignal) => {
  const row = utils.terminal.issue({
    type: terminalRowTypes.SETUP,
    id: providerKey,
  })
  const [provider] = await db.insertProvider({
    key: providerKey,
    name: 'DexScreener',
  })
  const allNetworksId = utils.chainIdToNetworkId(0)
  const [listOfAllTokens] = await db.insertList({
    providerId: provider.providerId,
    networkId: allNetworksId,
    key: 'api',
    name: 'DexScreener',
  })
  const [latestProfiles, latestBoosted, topBoosted] = await Promise.all([
    dexscreenerApi.getLatestTokenProfiles({ signal }),
    dexscreenerApi.getLatestTokenBoosts({ signal }),
    dexscreenerApi.getTopTokenBoosts({ signal }),
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
  // updateStatus({
  //   provider: 'dexscreener',
  //   message: `dexscreener found ${allChainIds.size} chains`,
  //   phase: 'setup',
  // })
  const chainBlacklist = new Set<string>()
  for (const chainId of allChainIds.values()) {
    const chain = chainIdToChain.get(chainId)
    if (!chain) {
      chainBlacklist.add(chainId)
      continue
    }
  }
  // updateStatus({
  //   provider: 'dexscreener',
  //   message: `dexscreener blacklisted ${chainBlacklist.size} chains`,
  //   phase: 'setup',
  // })
  row.createCounter('blacklisted', true)
  row.increment('blacklisted', chainBlacklist)
  await limitBy<[string, ChainInfo]>('dexscreener', 32).map([...parsedChainInfo.entries()], async ([key, info]) => {
    const chain = chainIdToChain.get(key)
    if (!chain) {
      return
    }
    const url = new URL(info.url)
    const image = await fetch(url).then(responseToBuffer)
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
  const relevantChains = [...chainIdToChain.entries()].filter(([key]) => {
    return key === 'pulsechain' || key === 'ethereum'
  })
  const section = row.issue(providerKey)
  row.createCounter(terminalCounterTypes.NETWORK)
  row.incrementTotal(
    terminalCounterTypes.NETWORK,
    utils.mapToSet.network(relevantChains, ([, c]) => c.id),
  )
  row.createCounter(terminalCounterTypes.TOKEN)
  row.incrementTotal(terminalCounterTypes.TOKEN, new Set())
  row.createCounter('image', true)
  await Promise.all(
    relevantChains.map(async ([key, chain]) => {
      const filter = {
        type: chain.type,
        chainId: chain.id.toString(),
      }
      const network = await db.getNetworks().where(filter).first<Network>()
      const k = chain.id.toString()
      if (!network) {
        row.increment(terminalLogTypes.EROR, new Set([k]))
        row.increment(terminalCounterTypes.NETWORK, new Set([k]))
        return
      }
      const startingTokens = (nativeTokens.get(`${chain.type}-${chain.id}`) ?? nativeTokens.get(chain.type))!
      const collector = new TerminalLinkedCollector(key, chain.type, chain.id, row)

      for (const token of startingTokens) {
        collector.markTokenAsPending(token)
      }
      let nextKeys = new Set<string>()
      while ((nextKeys = collector.getPendingTokens(16)).size) {
        await Promise.all([
          collector.collect(nextKeys, signal),
          collector.collectDecimals(nextKeys),
        ])
      }
      const [all, header] = collector.toTokenLists()
      const addressToHeaderUri = new Map<string, string>(header)
      for (const token of all) {
        const chainTokenId = utils.counterId.token([chain.id, token.address])
        const task = section.task(`saving-${key}-${token.address.toLowerCase()}`, {
          type: terminalRowTypes.STORAGE,
          id: providerKey,
          message: 'save',
          kv: {
            key,
            chainId: chain.id,
            type: chain.type,
            address: token.address,
          },
        })
        const { listToken } = await db.fetchImageAndStoreForToken({
          listId: listOfAllTokens.listId,
          providerKey: provider.providerId,
          uri: token.logoURI ?? null,
          originalUri: token.logoURI ?? null,
          signal,
          token: {
            type: 'erc20',
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            networkId: network.networkId,
            providedId: token.address,
          },
        })
        task.complete()
        const headerUri = addressToHeaderUri.get(token.address.toLowerCase())
        if (!headerUri) continue

        const headTask = section.task(`head-${key}-${token.address.toLowerCase()}`, {
          type: terminalRowTypes.STORAGE,
          id: providerKey,
          message: 'head',
          kv: {
            key,
            chainId: chain.id,
            type: chain.type,
            address: token.address,
          },
        })
        await db
          .fetchAndInsertHeader({
            uri: headerUri,
            originalUri: headerUri,
            listTokenId: listToken.listTokenId,
            providerKey: provider.providerId,
          })
          .catch((e) => {
            row.increment(terminalLogTypes.EROR, new Set([chainTokenId]))
            throw e
          })
          .finally(() => {
            headTask.complete()
          })
      }
      row.increment(terminalCounterTypes.NETWORK, new Set([k]))
    }),
  )
  row.remove(providerKey)
  row.complete()
}
