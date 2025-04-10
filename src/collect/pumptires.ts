import _, { result } from 'lodash'
import { concatHex, parseAbi, getAddress, Hex, keccak256 } from 'viem'
import * as db from '@/db'
import * as utils from '@/utils'
import { pulsechain } from 'viem/chains'
import { fetch } from '@/fetch'
import { log } from '@/logger'
import * as chains from 'viem/chains'
import { tableNames } from '@/db/tables'
import { Token } from 'knex/types/tables.js'
import type * as types from '@/types'

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

const collectTokens = async (knownList: Token[], listId: string, filter: string) => {
  const relevantData: TokenInfo[] = []
  let page = 1
  let pageCount = 0
  // const knownList =
  //   .limit(100)
  do {
    const url = new URL('https://api.pump.tires/api/tokens')
    url.searchParams.set('page', `${page}`)
    url.searchParams.set('filter', filter)
    if (page % 10 === 0) {
      log('progress %o', url.href)
    }
    let response!: Response
    let first: undefined | TokenInfo = undefined
    await utils.retry(async () => {
      const res = await fetch(url)
      const result = (await res.json()) as Response
      try {
        first = result.tokens[0]
        response = result
      } catch (err) {
        log(result)
        throw err
      }
    })
    if (!first) {
      break
    }
    // response.tokens.forEach((token) => {
    //   if (getAddress(token.address) === getAddress('0x84601f4e914E00Dc40296Ac11CdD27926BE319f2')) {
    //     log('token', token)
    //   }
    // })
    relevantData.push(...response.tokens)
    if (pageCount !== response.totalPages) {
      pageCount = response.totalPages
      log('page count update %o', pageCount)
    }
    page += 1
    const firstAddress = getAddress((first as TokenInfo).address)
    if (knownList.find((t) => getAddress(t.providedId) === firstAddress)) {
      break
    }
    // const firstAddress = getAddress((first as TokenInfo).address)
    // const exists = knownList.find((t) => getAddress(t.address) === firstAddress)
    // if (exists) {
    //   break
    // }
  } while (page <= pageCount)
  return _.uniqBy(relevantData, (t) => getAddress(t.address))
}

export const collect = async () => {
  const providerKey = 'pumptires'
  const listKey = 'tokens'
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
  const [createdTokens, launchedTokens] = await Promise.all([
    collectTokens(knownPumptiresList, pumptiresList.listId, 'created_timestamp'),
    collectTokens(knownLaunchedList, pumptiresList.listId, 'launch_timestamp'),
  ])
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
  await utils.spinner('pumptires:created', async (l) => {
    l.incrementMax(createdTokens.length)
    await utils.limit.map(createdTokens, async (token: TokenInfo) => {
      const originalUri = toURI(token)
      await db.fetchImageAndStoreForToken({
        listId: pumptiresList.listId,
        uri: originalUri,
        originalUri,
        providerKey,
        token: {
          name: token.name,
          symbol: token.symbol,
          decimals: 18,
          providedId: token.address,
          networkId: network.networkId,
        },
      })
    })
  })
  await utils.spinner('pumptires:launched', async (l) => {
    l.incrementMax(launchedTokens.length)
    await utils.limit.map(launchedTokens, async (token: TokenInfo) => {
      const originalUri = toURI(token)
      await db.fetchImageAndStoreForToken({
        listId: pumptiresList.listId,
        uri: originalUri,
        originalUri,
        providerKey,
        token: {
          name: token.name,
          symbol: token.symbol,
          decimals: 18,
          providedId: token.address,
          networkId: network.networkId,
        },
      })
    })
  })
  // check all LAUNCHED tokens for pairing with 1b pls
  await utils.spinner('pumptires:highcap', async (l) => {
    const knownLaunchedList: types.TokenInfo[] = await db
      .getTokensUnderListId()
      .where('listId', pumptiresLaunchedList.listId)
      .orderBy(`${tableNames.listToken}.created_at`, 'desc')
    l.incrementMax(knownLaunchedList.length)
    await utils.limit.map(knownLaunchedList, async (token: types.TokenInfo) => {
      const address = token.providedId as Hex
      const {
        token0,
        // token1,
        reserves: [rt0, rt1],
      } = await getReserves(address, situation, wpls)
      if (!rt0 || !rt1) {
        l.incrementCurrent()
        return
      }
      const wplsReserve = getAddress(token0) === getAddress(wpls) ? rt0 : rt1
      // const tokenReserve = token1 === wpls ? rt0 : rt1
      const oneBillion = 1_000_000_000n
      const oneEther = 10n ** 18n
      const oneBillionWei = oneBillion * oneEther
      if (wplsReserve >= oneBillionWei) {
        const originalUri = token.uri
        log('inserting highcap token %o', token.providedId)
        await db.fetchImageAndStoreForToken({
          listId: highMarketCapList.listId,
          uri: originalUri,
          originalUri,
          providerKey,
          token: {
            name: token.name,
            symbol: token.symbol,
            decimals: 18,
            providedId: token.providedId,
            networkId: network.networkId,
          },
        })
      }
      l.incrementCurrent()
    })
  })
}

const client = utils.publicClient(chains.pulsechain)

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
