import _ from 'lodash'
import { concatHex, parseAbi, getAddress, Hex, keccak256 } from 'viem'
import { failureLog, limitBy, retry } from '@gibs/utils'
import * as db from '../db'
import * as utils from '../utils'
import { pulsechain } from 'viem/chains'
import { fetch } from '../fetch'
import * as chains from 'viem/chains'
import type { Token } from '../db/schema-types'
import type * as types from '../types'
import { terminalRowTypes, TerminalSectionProxy, TerminalRowProxy, terminalCounterTypes } from '../log/types'
import { BaseCollector, DiscoveryManifest } from './base-collector'
import { eq, desc } from 'drizzle-orm'
import * as s from '../db/schema'

const providerKey = 'pumptires'
const listKey = 'tokens'

const limitTokens = limitBy<[TokenInfo, number]>(`${providerKey}-tokens`, 16)
const limitHighCapSorting = limitBy<types.TokenInfo>(`${providerKey}-highcap`, 16)
type InsertHighCapToken = Omit<Parameters<typeof db.fetchImageAndStoreForToken>[0], 'listTokenOrderId'> & {
  listTokenOrderId: number
  wplsReserve: bigint
}
const insertHighCapTokens = limitBy<[InsertHighCapToken, number]>(`${providerKey}-highcap-inserts`, 16)

type TokenInfo = {
  address: Hex
  name: string
  symbol: string
  image_cid: string
  description: string
  price: string
  price_5m_ago: string
  price_ath: string
  price_atl: string
  tokens_sold: string
  total_supply: string
  market_value: string
  total_volume_usd: string
  reserve_token: string | null
  reserve_wpls: string | null
  locked_lp: string | null
  lp_total_supply: string | null
  created_timestamp: number
  latest_activity_timestamp: number
  is_launched: boolean
  launch_timestamp: number
  pair_address: string | null
  creator_address: string
  creator_username: string
  creator_avatar_cid: string
}

const API_BASE = 'https://api2.pump.tires/api/tokens'

type ApiResponse = {
  hasMore: boolean
  limit: number
  nextCursor: string | null
  prevCursor: string | null
  tokens: TokenInfo[]
}

/** Fetch a single page from the pump.tires v2 cursor-based API. */
const retrieveData = async ({
  filter,
  cursor,
  row,
  section,
  signal,
}: {
  filter: string
  cursor: string | null
  row: TerminalRowProxy
  section: TerminalSectionProxy
  signal: AbortSignal
}): Promise<ApiResponse> => {
  const url = new URL(API_BASE)
  url.searchParams.set('filter', filter)
  url.searchParams.set('direction', 'next')
  if (cursor) url.searchParams.set('cursor', cursor)

  const label = cursor ? cursor.slice(0, 20) : 'first'
  const task = section.task(`${providerKey}-${filter}-${label}`, {
    type: terminalRowTypes.STORAGE,
    id: providerKey,
    kv: { filter, cursor: label },
  })
  const cacheKey = `${providerKey}-${filter}-${cursor ?? 'first'}`
  return await db
    .cachedJSON<ApiResponse>(cacheKey, signal, async () => {
      return await retry(
        async () => {
          const res = await fetch(url, { signal }).catch((err: Error) => {
            failureLog('fetch error %o', err.message)
            throw err
          })
          const result = (await res.json().catch((err: Error) => {
            failureLog('json error %o', err.message)
            throw err
          })) as ApiResponse
          if (!result.tokens) {
            throw new Error('unexpected response: missing tokens array')
          }
          return result
        },
        { signal },
      )
    })
    .catch((err) => {
      failureLog('%o', err)
      throw err
    })
    .finally(() => {
      row.increment('pages', `${filter}-${label}`)
      task.complete()
    })
}

/** Walk the cursor-based API until we hit known tokens or run out of pages. */
const collectTokens = async (
  knownList: Token[],
  filter: string,
  row: TerminalRowProxy,
  section: TerminalSectionProxy,
  signal: AbortSignal,
) => {
  const knownAddresses = new Set(knownList.map((t) => getAddress(t.providedId)))
  const relevantData: TokenInfo[] = []
  let cursor: string | null = null

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal.aborted) return
    const response = await retrieveData({ filter, cursor, row, section, signal })
    if (signal.aborted) return

    let hitKnown = false
    for (const token of response.tokens) {
      if (knownAddresses.has(getAddress(token.address))) {
        hitKnown = true
        break
      }
      relevantData.push(token)
    }

    if (hitKnown || !response.hasMore || !response.nextCursor) break
    cursor = response.nextCursor
  }

  return _.uniqBy(relevantData, (t) => getAddress(t.address))
}

class PumptiresCollector extends BaseCollector {
  readonly key = 'pumptires'

  async discover(_signal: AbortSignal): Promise<DiscoveryManifest> {
    const [provider] = await db.insertProvider({
      key: providerKey,
      name: 'tokens',
    })
    const network = await db.insertNetworkFromChainId(pulsechain.id)
    await db.insertList({
      key: listKey,
      name: listKey,
      providerId: provider.providerId,
      networkId: network.networkId,
      default: true,
    })
    await db.insertList({
      key: 'launched',
      name: 'Launched',
      providerId: provider.providerId,
      networkId: network.networkId,
      default: false,
    })
    await db.insertList({
      key: 'highcap',
      name: 'High Market Cap',
      providerId: provider.providerId,
      networkId: network.networkId,
      default: false,
    })

    return [
      {
        providerKey,
        lists: [{ listKey }, { listKey: 'launched' }, { listKey: 'highcap' }],
      },
    ]
  }

  async collect(signal: AbortSignal): Promise<void> {
    await retry(() => collectAttempt(signal), { attempts: 3, signal })
  }
}

export const collectAttempt = async (signal: AbortSignal) => {
  const row =
    utils.terminal.get(providerKey) ??
    utils.terminal.issue({
      id: providerKey,
      type: terminalRowTypes.SETUP,
    })
  row.update({ type: terminalRowTypes.SETUP })
  try {
    const [provider] = await db.insertProvider({
      key: providerKey,
      name: 'tokens',
    })
    const network = await db.insertNetworkFromChainId(pulsechain.id)
    const [pumptiresList] = await db.insertList({
      key: listKey,
      name: listKey,
      providerId: provider.providerId,
      networkId: network.networkId,
      default: true,
    })
    const [pumptiresLaunchedList] = await db.insertList({
      key: 'launched',
      name: 'Launched',
      providerId: provider.providerId,
      networkId: network.networkId,
      default: false,
    })
    const [highMarketCapList] = await db.insertList({
      key: 'highcap',
      name: 'High Market Cap',
      providerId: provider.providerId,
      networkId: network.networkId,
      default: false,
    })
    const knownPumptiresList = (await db
      .getTokensUnderListId()
      .where(eq(s.listToken.listId, pumptiresList.listId))
      .orderBy(desc(s.listToken.createdAt))) as unknown as types.TokenInfo[]
    const knownLaunchedList = (await db
      .getTokensUnderListId()
      .where(eq(s.listToken.listId, pumptiresLaunchedList.listId))
      .orderBy(desc(s.listToken.createdAt))) as unknown as types.TokenInfo[]
    const tasks = row.issue(providerKey)
    row.createCounter(terminalCounterTypes.NETWORK)
    row.incrementTotal(terminalCounterTypes.NETWORK, `${369}`)
    row.createCounter('pages', true)
    const [createdTokens, launchedTokens] = await Promise.all([
      collectTokens(knownPumptiresList, 'created_timestamp', row, tasks, signal),
      collectTokens(knownLaunchedList, 'launch_timestamp', row, tasks, signal),
    ])
    row.hideSection(providerKey)
    if (signal.aborted || !createdTokens || !launchedTokens) {
      return
    }
    const situation = [
      {
        factory: '0x1715a3E4A142d8b698131108995174F37aEBA10D',
        initCode: '0x59fffffddd756cba9095128e53f3291a6ba38b21e3df744936e7289326555d62',
      },
      {
        factory: '0x29eA7545DEf87022BAdc76323F373EA1e707C523',
        initCode: '0x5dff1ac2d132f5ac2841294c6e9fc0ebafae8d447fac7996ef21c21112f411f1',
      },
    ] as { factory: Hex; initCode: Hex }[]
    const wpls = '0xA1077a294dDE1B09bB078844df40758a5D0f9a27'

    const toURI = (token: TokenInfo) => `https://ipfs-pump-tires.b-cdn.net/ipfs/${token.image_cid}`
    row.createCounter('created', true)
    const tokenIDs = utils.mapToSet.token(createdTokens, (t) => [+network.chainId, t.address])
    const indexedTokenIds = Array.from(createdTokens).map(
      (t, i) => [t, knownPumptiresList.length + i] as [TokenInfo, number],
    )
    row.incrementTotal('created', tokenIDs)
    row.increment(terminalCounterTypes.TOKEN, tokenIDs)
    await limitTokens.map(indexedTokenIds, async ([token, i]) => {
      if (signal.aborted) {
        return
      }
      row.increment(terminalCounterTypes.TOKEN, utils.counterId.token([+network.chainId, token.address]))
      const originalUri = toURI(token)
      const chainTokenId = utils.counterId.token([+network.chainId, token.address])
      await db
        .fetchImageAndStoreForToken({
          listId: pumptiresList.listId,
          uri: originalUri,
          originalUri,
          providerKey,
          listTokenOrderId: i,
          signal,
          token: {
            name: token.name,
            symbol: token.symbol,
            decimals: 18,
            providedId: token.address,
            networkId: network.networkId,
          },
        })
        .finally(() => {
          row.increment('created', chainTokenId)
        })
    })
    row.createCounter('launched', true)
    row.incrementTotal(
      'launched',
      utils.mapToSet.token(launchedTokens, (t) => [+network.chainId, t.address]),
    )
    const indexedLaunchedTokens = Array.from(launchedTokens).map(
      (t, i) => [t, knownLaunchedList.length + i] as [TokenInfo, number],
    )
    await limitTokens.map(indexedLaunchedTokens, async ([token, i]) => {
      if (signal.aborted) return
      const originalUri = toURI(token)
      const chainTokenId = utils.counterId.token([+network.chainId, token.address])
      await db
        .fetchImageAndStoreForToken({
          listId: pumptiresLaunchedList.listId,
          uri: originalUri,
          originalUri,
          providerKey,
          listTokenOrderId: i,
          signal,
          token: {
            name: token.name,
            symbol: token.symbol,
            decimals: 18,
            providedId: token.address,
            networkId: network.networkId,
          },
        })
        .finally(() => {
          row.increment('launched', chainTokenId)
        })
    })
    // check all LAUNCHED tokens for pairing with 1b pls
    const updatedKnownLaunchedList = (await db
      .getTokensUnderListId()
      .where(eq(s.listToken.listId, pumptiresLaunchedList.listId))) as unknown as types.TokenInfo[]
    // .orderBy(`${tableNames.listToken}.created_at`, 'desc')
    row.createCounter('filter', true)
    row.incrementTotal(
      'filter',
      utils.mapToSet.token(updatedKnownLaunchedList, (t) => [+network.networkId, t.providedId]),
    )
    const highCapTokens = await limitHighCapSorting.map(
      updatedKnownLaunchedList,
      async (token): Promise<InsertHighCapToken | null> => {
        if (signal.aborted) return null
        const address = token.providedId as Hex
        const {
          token0,
          // token1,
          reserves: [rt0, rt1],
        } = await getReserves(address, situation, wpls, signal)
        let result: null | InsertHighCapToken = null
        if (rt0 && rt1) {
          const wplsReserve = getAddress(token0) === getAddress(wpls) ? rt0 : rt1
          // const tokenReserve = token1 === wpls ? rt0 : rt1
          const oneBillion = 1_000_000_000n
          const oneEther = 10n ** 18n
          const oneBillionWei = oneBillion * oneEther
          if (wplsReserve >= oneBillionWei) {
            const originalUri = token.uri
            result = {
              listId: highMarketCapList.listId,
              uri: originalUri,
              originalUri,
              providerKey,
              signal,
              listTokenOrderId: 0,
              wplsReserve,
              token: {
                name: token.name,
                symbol: token.symbol,
                decimals: 18,
                providedId: token.providedId,
                networkId: network.networkId,
              },
            }
          }
        }
        const chainTokenId = utils.counterId.token([+network.chainId, address])
        row.increment('filter', chainTokenId)
        return result
      },
    )
    const sortedInserts = _(highCapTokens)
      .compact()
      .sortBy((a) => -a.wplsReserve)
      .map((value, index) => [value, index] as [InsertHighCapToken, number])
      .value()
    row.createCounter('highcap', true)

    row.incrementTotal(
      'highcap',
      utils.mapToSet.token(sortedInserts, ([t]) => [+network.networkId, t.token.providedId]),
    )
    await insertHighCapTokens.map(sortedInserts, async ([insert, index]) => {
      if (signal.aborted) return
      await db.fetchImageAndStoreForToken({
        ...insert,
        listTokenOrderId: index,
      })
      row.increment('highcap', utils.counterId.token([+network.chainId, insert.token.providedId]))
    })
    row.increment(terminalCounterTypes.NETWORK, `${369}`)
  } finally {
    row.complete()
  }
}

const client = utils.chainToPublicClient(chains.pulsechain)

const univ2Abi = parseAbi([
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
])

const getReserves = async (
  token: Hex,
  situations: { factory: Hex; initCode: Hex }[],
  wpls: Hex,
  signal?: AbortSignal,
) => {
  // the token pairs are the same for both situations so we can just use the first one
  const [situation] = situations
  const [, token0, token1] = tokenToPair(wpls, token, situation.factory, situation.initCode)
  const calls = situations.map(({ factory, initCode }) => {
    const [pair] = tokenToPair(wpls, token, factory, initCode)
    return {
      abi: univ2Abi,
      address: pair,
      functionName: 'getReserves',
      args: [],
    }
  })
  const results = await Promise.race([
    client.multicall({ contracts: calls }),
    new Promise<[]>((resolve) => {
      const timer = setTimeout(() => resolve([]), 15_000)
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve([])
        },
        { once: true },
      )
    }),
  ])
  // we can do this because the same rules govern the order of the tokens in the pair
  // the order of the tokens in the pair is the same for both situations
  const reserves = results.reduce(
    (acc, result) => {
      if (result.status === 'success') {
        const [rt0, rt1, _] = result.result
        acc[0] += rt0
        acc[1] += rt1
      }
      return acc
    },
    [0n, 0n, 0] as [bigint, bigint, number],
  )
  return {
    token0,
    token1,
    reserves,
  }
}

const tokenToPair = _.memoize(
  (token0: Hex, token1: Hex, factory: Hex, initCodeHash: Hex) => {
    const tl0 = token0.toLowerCase()
    const tl1 = token1.toLowerCase()
    const [t0, t1] = tl0 < tl1 ? [token0, token1] : [token1, token0]
    // should check chain for these values in the future
    const input = concatHex(['0xff', factory, keccak256(concatHex([t0, t1])), initCodeHash])
    return [`0x${keccak256(input).slice(-40)}` as Hex, getAddress(t0), getAddress(t1)] as const
  },
  (token0, token1, factory, initCodeHash) => {
    return `${token0}-${token1}-${factory}-${initCodeHash}`
  },
)

const instance = new PumptiresCollector()
export default instance
export const collect = (signal: AbortSignal) => instance.collect(signal)
