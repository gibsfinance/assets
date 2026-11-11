import { failureLog, limitBy } from '@gibs/utils'
import { limitByTime } from '@gibs/utils/fetch'

import * as db from '../db'
import * as utils from '../utils'
import { terminalCounterTypes, terminalRowTypes } from '../log/types'
import { BaseCollector, type DiscoveryManifest } from './base-collector'
import { createCoinGeckoClient, type CoinGeckoClient } from './coingecko-client'
import { resolvePlatform, type ResolvedPlatform } from './coingecko-platforms'
import {
  allChainsFilled,
  parseCoinPlatforms,
  parseMarketPage,
  parseTokenListDetails,
  selectTopTokens,
  type CoinPlatforms,
  type MarketCoin,
  type TopToken,
} from './coingecko-top-tokens-select'
import {
  MARKETS_PAGE_SIZE,
  readCoinGeckoTopTokensSettings,
  type CoinGeckoTopTokensSettings,
} from './coingecko-top-tokens-settings'
import { publishWalkedList, resolveListVersion, retireStaleLists } from './versioned-lists'

/**
 * The provider key. It is a provider of its own, not a second set of lists under `coingecko`:
 * the full collector registers one list per chain holding every coin CoinGecko knows, unranked,
 * and keeps its list keys (the bare chain id) and its ranking slots. A second collector cannot
 * share its registry key, and a separate key lets this one fail, be ranked and be turned off alone.
 */
export const providerKey = 'coingecko-top-tokens'
const providerName = 'CoinGecko: top tokens'

/** A list with fewer tokens than this is skipped rather than created near-empty. */
export const MIN_LIST_SIZE = 5

/** The list key for one chain, `top-tokens-<chain id>`, following the routescan naming. */
export const topTokensListKey = (chainId: number): string => `top-tokens-${chainId}`

/** A configured chain that CoinGecko knows, with the platform that carries its contracts. */
type ChainTarget = {
  chainId: number
  platformId: string
  platformName: string
  platform: ResolvedPlatform
}

/** One list ready to have its tokens stored. */
type PreparedList = {
  providerId: string
  listKey: string
  listId: string
  /** This list's own registered licence (see insertList), for effectiveEntryLicense. */
  license: string | null
  networkId: string
  tokens: TopToken[]
}

/** Why the walk over market pages stopped. */
type WalkEnd = 'filled' | 'exhausted' | 'failed' | 'aborted'

/**
 * Read market pages, largest coin first, until every chain has enough tokens, the pages run
 * out, the page limit is reached, or a page cannot be fetched. `failed` means the ranking
 * may be cut short; `exhausted` means CoinGecko or the page limit is the end of the ranking.
 */
export const walkMarketPages = async ({
  client,
  signal,
  pageLimit,
  isFilled,
}: {
  client: CoinGeckoClient
  signal: AbortSignal
  pageLimit: number
  isFilled: (coins: readonly MarketCoin[]) => boolean
}): Promise<{ coins: MarketCoin[]; end: WalkEnd }> => {
  const coins: MarketCoin[] = []
  for (let page = 1; page <= pageLimit; page++) {
    const raw = await client.getJson(
      '/coins/markets',
      { vs_currency: 'usd', order: 'market_cap_desc', per_page: MARKETS_PAGE_SIZE, page, sparkline: false },
      signal,
    )
    if (signal.aborted) return { coins, end: 'aborted' }
    if (!Array.isArray(raw)) return { coins, end: 'failed' }
    coins.push(...parseMarketPage(raw))
    if (raw.length < MARKETS_PAGE_SIZE) return { coins, end: 'exhausted' }
    if (isFilled(coins)) return { coins, end: 'filled' }
  }
  return { coins, end: 'exhausted' }
}

/**
 * Match configured chain ids to CoinGecko platforms through `chain_identifier`. Chains CoinGecko
 * does not list, or lists without a numeric identifier, are returned apart so the caller can
 * leave their lists alone.
 */
export const matchChainsToPlatforms = (
  rawPlatforms: unknown,
  chainIds: readonly number[],
): { targets: ChainTarget[]; missing: number[] } => {
  const byChainId = new Map<number, ChainTarget>()
  for (const entry of Array.isArray(rawPlatforms) ? rawPlatforms : []) {
    const { id, name, chain_identifier: chainIdentifier } = (entry ?? {}) as Record<string, unknown>
    if (typeof id !== 'string' || typeof chainIdentifier !== 'number' || byChainId.has(chainIdentifier)) continue
    // A numeric chain identifier always resolves; only a supported non-EVM id comes back not-EVM.
    const platform = resolvePlatform(id, chainIdentifier)!
    if (!platform.evm) continue
    byChainId.set(chainIdentifier, {
      chainId: chainIdentifier,
      platformId: id,
      platformName: typeof name === 'string' && name ? name : id,
      platform,
    })
  }
  const targets = chainIds.flatMap((chainId) => byChainId.get(chainId) ?? [])
  const found = new Set(targets.map((target) => target.chainId))
  return { targets, missing: chainIds.filter((chainId) => !found.has(chainId)) }
}

/** What a collector reads and how it builds its client; both replaceable in tests. */
export type CoinGeckoTopTokensOptions = {
  env?: NodeJS.ProcessEnv
  createClient?: (settings: CoinGeckoTopTokensSettings) => CoinGeckoClient
}

const defaultCreateClient = (settings: CoinGeckoTopTokensSettings): CoinGeckoClient =>
  createCoinGeckoClient({
    settings,
    waitForTurn: limitByTime(settings.minimumIntervalMs),
    log: (message) => failureLog('provider=%o %s', providerKey, message),
  })

/**
 * Top tokens by market capitalisation, one list per chain (`top-tokens-<chain id>`).
 *
 * Phase 1 (discover) makes every request: the platform table, the coin-to-address table,
 * market pages in rank order, and each chain's token list for decimals. It files a list
 * version per chain when the membership changed (see `resolveListVersion`).
 * Phase 2 (collect) stores each token and its logo through `fetchImageAndStoreForToken`.
 *
 * A chain whose data could not be read leaves its list as it was. One chain failing never
 * stops the others.
 */
export class CoinGeckoTopTokensCollector extends BaseCollector {
  readonly key = providerKey

  private prepared: PreparedList[] = []
  private readonly options: CoinGeckoTopTokensOptions

  constructor(options: CoinGeckoTopTokensOptions = {}) {
    super()
    this.options = options
  }

  async discover(signal: AbortSignal): Promise<DiscoveryManifest> {
    this.prepared = []
    const row =
      utils.terminal.get(providerKey) ?? utils.terminal.issue({ type: terminalRowTypes.SETUP, id: providerKey })
    try {
      const settings = readCoinGeckoTopTokensSettings(this.options.env ?? process.env)
      const client = (this.options.createClient ?? defaultCreateClient)(settings)

      const rawPlatforms = await client.getJson('/asset_platforms', {}, signal)
      const { targets, missing } = matchChainsToPlatforms(rawPlatforms, settings.chainIds)
      if (targets.length === 0) {
        failureLog('provider=%o no configured chain found among the CoinGecko platforms', providerKey)
        return []
      }
      const platformsByCoin = parseCoinPlatforms(
        await client.getJson('/coins/list', { include_platform: true }, signal),
      )
      if (platformsByCoin.size === 0) {
        failureLog('provider=%o coins/list gave no coins', providerKey)
        return []
      }

      const walk = await walkMarketPages({
        client,
        signal,
        pageLimit: settings.marketPageLimit,
        isFilled: (coins) =>
          allChainsFilled({
            rankedCoins: coins,
            platformsByCoin,
            chains: targets,
            limit: settings.tokensPerChain,
          }),
      })
      if (walk.end === 'aborted' || signal.aborted) return []
      if (walk.coins.length === 0) {
        failureLog('provider=%o coins/markets gave no coins', providerKey)
        return []
      }

      const [provider] = await db.insertProvider({ key: providerKey, name: providerName })
      // Lists this run could not judge keep what they have.
      const unreliableKeys = new Set(missing.map(topTokensListKey))
      const prepared: PreparedList[] = []

      for (const target of targets) {
        if (signal.aborted) return []
        const listKey = topTokensListKey(target.chainId)
        try {
          const list = await this.prepareChain({
            target,
            provider,
            settings,
            client,
            platformsByCoin,
            rankedCoins: walk.coins,
            rankingMayBeCutShort: walk.end === 'failed',
            signal,
          })
          if (list === 'unreliable') unreliableKeys.add(listKey)
          else if (list) prepared.push(list)
        } catch (error) {
          unreliableKeys.add(listKey)
          failureLog('provider=%o list=%o failed: %o', providerKey, listKey, (error as Error).message)
        }
      }

      if (signal.aborted) return []
      await retireStaleLists({
        providerId: provider.providerId,
        providerKey,
        liveKeys: new Set(prepared.map((list) => list.listKey)),
        unreliableKeys,
      })

      this.prepared = prepared
      return [{ providerKey, lists: prepared.map((list) => ({ listKey: list.listKey, listId: list.listId })) }]
    } finally {
      row.complete()
    }
  }

  /**
   * Select, register and version one chain's list. Answers `null` for a chain with too few
   * tokens to list, and `'unreliable'` when the ranking may be cut short before the chain
   * has all the tokens it should.
   */
  private async prepareChain({
    target,
    provider,
    settings,
    client,
    platformsByCoin,
    rankedCoins,
    rankingMayBeCutShort,
    signal,
  }: {
    target: ChainTarget
    provider: { providerId: string }
    settings: CoinGeckoTopTokensSettings
    client: CoinGeckoClient
    platformsByCoin: ReadonlyMap<string, CoinPlatforms>
    rankedCoins: readonly MarketCoin[]
    rankingMayBeCutShort: boolean
    signal: AbortSignal
  }): Promise<PreparedList | 'unreliable' | null> {
    const selection = {
      rankedCoins,
      platformsByCoin,
      platformId: target.platformId,
      platform: target.platform,
      limit: settings.tokensPerChain,
    }
    const candidates = selectTopTokens({ ...selection, details: new Map() })
    if (rankingMayBeCutShort && candidates.length < settings.tokensPerChain) return 'unreliable'
    if (candidates.length < MIN_LIST_SIZE) return null

    const rawTokenList = await client.getJson(`/token_lists/${target.platformId}/all.json`, {}, signal)
    const tokens = selectTopTokens({ ...selection, details: parseTokenListDetails(rawTokenList) })

    const listKey = topTokensListKey(target.chainId)
    const network = await db.insertNetworkFromChainId(target.chainId, 'evm')
    const [list] = await db.insertList({
      providerId: provider.providerId,
      providerKey,
      networkId: network.networkId,
      key: listKey,
      name: `CoinGecko: top tokens on ${target.platformName}`,
      ...(await resolveListVersion({
        providerId: provider.providerId,
        listKey,
        addresses: tokens.map((token) => token.address),
      })),
    })
    return {
      providerId: provider.providerId,
      listKey,
      listId: list.listId,
      license: list.license,
      networkId: network.networkId,
      tokens,
    }
  }

  async collect(signal: AbortSignal): Promise<void> {
    if (this.prepared.length === 0) return
    const row =
      utils.terminal.get(providerKey) ?? utils.terminal.issue({ type: terminalRowTypes.SETUP, id: providerKey })
    const limit = limitBy<TopToken>(`${providerKey}-insert`, 4)
    try {
      for (const list of this.prepared) {
        if (signal.aborted) return
        row.createCounter(terminalCounterTypes.TOKEN)
        row.incrementTotal(
          terminalCounterTypes.TOKEN,
          new Set(list.tokens.map((token) => `${list.listKey}:${token.address}`)),
        )
        let stored = 0
        await limit.map(list.tokens, async (token) => {
          if (signal.aborted) return
          try {
            await db.fetchImageAndStoreForToken({
              listId: list.listId,
              listTokenOrderId: token.orderIdx,
              uri: token.logoURI,
              originalUri: token.logoURI,
              providerKey,
              listLicense: list.license,
              signal,
              token: {
                name: token.name,
                symbol: token.symbol,
                decimals: token.decimals,
                networkId: list.networkId,
                providedId: token.address,
              },
            })
            stored += 1
            row.increment(terminalCounterTypes.TOKEN, `${list.listKey}:${token.address}`)
          } catch (error) {
            row.increment('erred', `${list.listKey}:${token.address}`)
            failureLog('token %o/%o/%o failed: %o', providerKey, list.listKey, token.address, (error as Error).message)
          }
        })
        await publishWalkedList({ providerKey, list, stored, signal })
      }
    } finally {
      row.complete()
    }
  }
}

const instance = new CoinGeckoTopTokensCollector()
export default instance
