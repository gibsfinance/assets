import _ from 'lodash'
import { getAddress, Hex } from 'viem'
import * as db from '@/db'
import * as utils from '@/utils'
import { pulsechain } from 'viem/chains'
import { fetch } from '@/fetch'
import { tableNames } from '@/db/tables'
import { log } from '@/logger'

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
  const tokens = await collectTokens(list.listId)
  await utils.spinner('pumptires', async (l) => {
    l.incrementMax(tokens.length)
    await utils.limit.map(tokens, async (token: TokenInfo) => {
      const originalUri = `https://ipfs-pump-tires.b-cdn.net/ipfs/${token.image_cid}`
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
      l.incrementCurrent()
    })
  })
}
