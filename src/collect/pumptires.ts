import _ from 'lodash'
import { concatHex, parseAbi, decodeFunctionResult, getAddress, Hex, keccak256, parseEther } from 'viem'
import * as db from '@/db'
import * as utils from '@/utils'
import { pulsechain } from 'viem/chains'
import { fetch } from '@/fetch'
import { tableNames } from '@/db/tables'
import { log } from '@/logger'
import * as chains from 'viem/chains'

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
}

const collectTokens = async (listId: string) => {
  const relevantData: TokenInfo[] = []
  let page = 1
  let pageCount = 0
  // const knownList = await db
  //   .getTokensUnderListId()
  //   .where('listId', listId)
  //   .orderBy(`${tableNames.listToken}.created_at`, 'desc')
  //   .limit(100)
  do {
    const url = new URL('https://api.pump.tires/api/tokens')
    url.searchParams.set('page', `${page}`)
    url.searchParams.set('filter', 'created_timestamp')
    if (page % 10 === 0) {
      log('progress %o', url.href)
    }
    let response!: Response
    let first: undefined | TokenInfo = undefined
    await utils.retry(async () => {
      const res = await fetch(url)
      const result = (await res.json()) as Response
      first = result.tokens[0]
      response = result
    })
    if (!first) {
      break
    }
    // const firstAddress = getAddress((first as TokenInfo).address)
    // const exists = knownList.find((t) => getAddress(t.address) === firstAddress)
    // if (exists) {
    //   break
    // }
    relevantData.push(...response.tokens)
    if (pageCount !== response.totalPages) {
      pageCount = response.totalPages
      log('page count update %o', pageCount)
    }
    page += 1
  } while (page <= pageCount)
  return _.uniqBy(relevantData, 'address')
}

export const collect = async () => {
  const providerKey = 'pumptires'
  const listKey = 'tokens'
  const [provider] = await db.insertProvider({
    key: providerKey,
    name: 'tokens',
  })
  const network = await db.insertNetworkFromChainId(pulsechain.id)
  const [list] = await db.insertList({
    key: listKey,
    name: listKey,
    providerId: provider.providerId,
    networkId: network.networkId,
    default: true,
  })
  const [highMarketCapList] = await db.insertList({
    key: 'highcap',
    name: 'High Market Cap',
    providerId: provider.providerId,
    networkId: network.networkId,
    default: false,
  })
  const tokens = await collectTokens(list.listId)
  const factory = '0x29eA7545DEf87022BAdc76323F373EA1e707C523'
  const initCode = '0x5dff1ac2d132f5ac2841294c6e9fc0ebafae8d447fac7996ef21c21112f411f1'
  const wpls = '0xA1077a294dDE1B09bB078844df40758a5D0f9a27'
  await utils.spinner('pumptires', async (l) => {
    l.incrementMax(tokens.length)
    // const millionDollarMarketCap = parseEther('0.001') // add this constraint later
    await utils.limit.map(tokens, async (token: TokenInfo) => {
      const originalUri = `https://ipfs-pump-tires.b-cdn.net/ipfs/${token.image_cid}`
      const [pair, token0, token1] = tokenToPair(token.address, token.address, factory, initCode)
      const [reserves] = await Promise.all([
        getReserves(pair), // we care about this for the price
        db.fetchImageAndStoreForToken({
          listId: list.listId,
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
        }),
      ])
      const [rt0, rt1, timestamp] = reserves
      const wplsReserve = token0 === wpls ? rt0 : rt1
      const tokenReserve = token1 === wpls ? rt0 : rt1
      const oneBillion = 1_000_000_000n
      const oneEther = 10n ** 18n
      const oneBillionWei = oneBillion * oneEther
      // const amount = tokenReserve / wplsReserve
      // const price =
      if (wplsReserve > oneBillionWei) {
        console.log('inserting highcap token', token.address)
        await db.fetchImageAndStoreForToken({
          listId: list.listId,
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
      }
      l.incrementCurrent()
    })
  })
}

const client = utils.publicClient(chains.pulsechain)

const univ2Abi = parseAbi([
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
])

const getReserves = async (pair: Hex) => {
  const [result] = await client.multicall({
    contracts: [
      {
        abi: univ2Abi,
        address: pair,
        functionName: 'getReserves',
        args: [],
      },
    ],
  })
  if (result.status === 'failure') {
    return [0n, 0n, 0] as const
  }
  return result.result
}

const tokenToPair = _.memoize((token0: Hex, token1: Hex, factory: Hex, initCodeHash: Hex) => {
  const tl0 = token0.toLowerCase()
  const tl1 = token1.toLowerCase()
  const [t0, t1] = tl0 < tl1 ? [token0, token1] : [token1, token0]
  // should check chain for these values in the future
  const input = concatHex(['0xff', factory, keccak256(concatHex([t0, t1])), initCodeHash])
  return [`0x${keccak256(input).slice(-40)}` as Hex, getAddress(t0), getAddress(t1)] as const
})
