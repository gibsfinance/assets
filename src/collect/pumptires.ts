import _ from 'lodash'
import { concatHex, parseAbi, getAddress, Hex, keccak256 } from 'viem'
import { limit, limitBy, retry } from '@gibs/utils'
import * as db from '@/db'
import * as utils from '@/utils'
import { pulsechain } from 'viem/chains'
import { fetch } from '@/fetch'
import * as chains from 'viem/chains'
import { tableNames } from '@/db/tables'
import { Token } from 'knex/types/tables.js'
import type * as types from '@/types'
import { terminalRowTypes, TerminalSectionProxy, TerminalRowProxy, terminalCounterTypes } from '@/log/types'

const providerKey = 'pumptires'
const listKey = 'tokens'

const limiter = limitBy<number>(providerKey, 4)

type Creator = {
  address: Hex
  username: string
  bio: string
  avatar_cid: string
  twitter_id: string
  twitter_name: string
  twitter_username: string
  pending_token_create: string | null
  created_at: string
  updated_at: string
}
type TradeBatch = {
  total_buys: number
  total_sells: number
  total_amount_sold: string
  total_amount_bought: string
}
type TokenInfo = {
  address: Hex
  name: string
  symbol: string
  image_cid: string
  description: string
  price: string
  prev_price: string
  tokens_sold: string
  prev_tokens_sold: string
  total_burned: string
  last_burned_batch: string
  market_value: string
  prev_market_value: string
  latest_trade_batch: TradeBatch
  web: string
  telegram: string
  twitter: string
  created_timestamp: string
  latest_timestamp: string
  latest_burn_timestamp: string | null
  is_launched: boolean
  launch_timestamp: string | null
  creator: Creator
}

type Response = {
  totalPages: number
  tokens: TokenInfo[]
  message?: string
}

const retrieveData = async (
  filter: string,
  page: number,
  row: TerminalRowProxy,
  section: TerminalSectionProxy,
  signal: AbortSignal,
) => {
  const url = new URL('https://api.pump.tires/api/tokens')
  url.searchParams.set('page', `${page}`)
  url.searchParams.set('filter', filter)
  const task = section.task(`${providerKey}-${filter}-${page}`, {
    type: terminalRowTypes.STORAGE,
    id: providerKey,
    kv: {
      filter,
      page,
    },
  })
  return await retry(async () => {
    const res = await fetch(url, { signal })
    const result = (await res.json()) as Response
    // check that the list is not empty
    const a = result.tokens[0]
    return result
  }).finally(() => {
    row.increment('pages', `${filter}-${page}`)
    task.complete()
  })
}

const collectTokens = async (
  knownList: Token[],
  filter: string,
  row: TerminalRowProxy,
  section: TerminalSectionProxy,
  signal: AbortSignal,
) => {
  const relevantData: TokenInfo[] = []
  let page = 1
  let discontinue = false
  const first = await retrieveData(filter, page, row, section, signal)
  if (signal.aborted) {
    return
  }
  const pageCount = first.totalPages
  const emptyArray = _.range(1, pageCount + 1)
  await limiter.map(emptyArray, async (index) => {
    if (discontinue) {
      return
    }
    const page = index + 1
    const response = await retrieveData(filter, page, row, section, signal)
    if (signal.aborted) {
      return
    }
    relevantData.push(...response.tokens)
    const last = response.tokens[response.tokens.length - 1]
    if (!last) {
      discontinue = true
      return
    }
    const lastAddress = getAddress((last as TokenInfo).address)
    if (knownList.find((t) => getAddress(t.providedId) === lastAddress)) {
      discontinue = true
    }
  })
  return _.uniqBy(relevantData, (t) => getAddress(t.address))
}

export const collect = async (signal: AbortSignal) => {
  const row = utils.terminal.issue({
    id: providerKey,
    type: terminalRowTypes.SETUP,
  })
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
  const knownPumptiresList: types.TokenInfo[] = await db
    .getTokensUnderListId()
    .where('listId', pumptiresList.listId)
    .orderBy(`${tableNames.listToken}.created_at`, 'desc')
  const knownLaunchedList: types.TokenInfo[] = await db
    .getTokensUnderListId()
    .where('listId', pumptiresLaunchedList.listId)
    .orderBy(`${tableNames.listToken}.created_at`, 'desc')
  const tasks = row.issue('pumptires:tokens')
  row.createCounter(terminalCounterTypes.NETWORK)
  row.incrementTotal(terminalCounterTypes.NETWORK, `${369}`)
  const [createdTokens, launchedTokens] = await Promise.all([
    collectTokens(knownPumptiresList, 'created_timestamp', row, tasks, signal),
    collectTokens(knownLaunchedList, 'launch_timestamp', row, tasks, signal),
  ])
  if (signal.aborted || !createdTokens || !launchedTokens) {
    return
  }
  row.hideSection('pumptires:tokens')
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
  row.incrementTotal('created', tokenIDs)
  row.increment(terminalCounterTypes.TOKEN, tokenIDs)
  await limit.map(createdTokens, async (token: TokenInfo) => {
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
  await limit.map(launchedTokens, async (token: TokenInfo) => {
    const originalUri = toURI(token)
    const chainTokenId = `${network.networkId}-${token.address.toLowerCase()}`
    await db
      .fetchImageAndStoreForToken({
        listId: pumptiresList.listId,
        uri: originalUri,
        originalUri,
        providerKey,
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
  const updatedKnownLaunchedList: types.TokenInfo[] = await db
    .getTokensUnderListId()
    .where('listId', pumptiresLaunchedList.listId)
    .orderBy(`${tableNames.listToken}.created_at`, 'desc')
  row.createCounter('highcap', true)
  row.incrementTotal(
    'highcap',
    utils.mapToSet.token(updatedKnownLaunchedList, (t) => [+network.networkId, t.providedId]),
  )
  await limit.map(updatedKnownLaunchedList, async (token: types.TokenInfo) => {
    const address = token.providedId as Hex
    const {
      token0,
      // token1,
      reserves: [rt0, rt1],
    } = await getReserves(address, situation, wpls)
    if (rt0 && rt1) {
      const wplsReserve = getAddress(token0) === getAddress(wpls) ? rt0 : rt1
      // const tokenReserve = token1 === wpls ? rt0 : rt1
      const oneBillion = 1_000_000_000n
      const oneEther = 10n ** 18n
      const oneBillionWei = oneBillion * oneEther
      if (wplsReserve >= oneBillionWei) {
        const originalUri = token.uri
        await db.fetchImageAndStoreForToken({
          listId: highMarketCapList.listId,
          uri: originalUri,
          originalUri,
          providerKey,
          signal,
          token: {
            name: token.name,
            symbol: token.symbol,
            decimals: 18,
            providedId: token.providedId,
            networkId: network.networkId,
          },
        })
      }
    }
    const chainTokenId = `${network.networkId}-${address.toLowerCase()}`
    row.increment('highcap', chainTokenId)
  })
  row.increment(terminalCounterTypes.NETWORK, `${369}`)
  row.complete()
}

const client = utils.chainToPublicClient(chains.pulsechain)

const univ2Abi = parseAbi([
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
])

const getReserves = async (token: Hex, situations: { factory: Hex; initCode: Hex }[], wpls: Hex) => {
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
  const results = await client.multicall({
    contracts: calls,
  })
  return {
    token0,
    token1,
    reserves: results.find((r) => r.status === 'success')?.result ?? [0n, 0n, 0],
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
