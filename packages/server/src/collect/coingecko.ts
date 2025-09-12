import * as remoteTokenList from './remote-tokenlist'
import * as db from '../db'
import * as utils from '../utils'
import { terminalCounterTypes, terminalRowTypes } from '../log/types'
import promiseLimit from 'promise-limit'
import Coingecko from '@coingecko/coingecko-typescript';
import { Coins } from '@coingecko/coingecko-typescript/resources/index.mjs'

const client = new Coingecko({
  // proAPIKey: process.env['COINGECKO_API_KEY'],
  demoAPIKey: process.env.COINGECKO_API_KEY,
  // demoAPIKey: process.env['COINGECKO_DEMO_API_KEY'], // Optional, for Demo API access
  environment: 'demo', // 'demo' to initialize the client with Demo API access
});

// const trendingSearch = await client.trending();

const arbitrumOne = remoteTokenList.collect({
  providerKey: 'coingecko',
  listKey: 'arbitrum-one',
  tokenList: 'https://tokens.coingecko.com/arbitrum-one/all.json',
})

const uniswap = remoteTokenList.collect({
  providerKey: 'coingecko',
  listKey: 'uniswap',
  tokenList: 'https://tokens.coingecko.com/uniswap/all.json',
})

const zksync = remoteTokenList.collect({
  providerKey: 'coingecko',
  listKey: 'zksync',
  tokenList: 'https://tokens.coingecko.com/zksync/all.json',
})

// interface CoinMarketData {
//   id: string
//   symbol: string
//   name: string
//   image: string
//   current_price: number
//   market_cap: number
//   market_cap_rank: number
//   fully_diluted_valuation: number
//   total_volume: number
//   high_24h: number
//   low_24h: number
//   price_change_24h: number
//   price_change_percentage_24h: number
//   market_cap_change_24h: number
//   market_cap_change_percentage_24h: number
//   circulating_supply: number
//   total_supply: number
//   max_supply: number
//   ath: number
//   ath_change_percentage: number
//   ath_date: string
//   atl: number
//   atl_change_percentage: number
//   atl_date: string
//   roi: any
//   last_updated: string
//   platforms?: Record<string, string>
// }

const getCoinsMarkets = async (options: {
  vs_currency?: string
  order?: string
  per_page?: number
  page?: number
  sparkline?: boolean
  price_change_percentage?: string
  locale?: string
  precision?: string
} = {}) => {
  // vs_currency=usd&price_change_percentage=1h&per_page=1'
  // const params = new URLSearchParams({
  //   x_cg_pro_api_key: apiKey,
  //   vs_currency: options.vs_currency || 'usd',
  //   order: options.order || 'market_cap_desc',
  //   per_page: String(options.per_page || 250),
  //   page: String(options.page || 1),
  //   include_tokens: 'top',
  //   // sparkline: String(options.sparkline || false),
  //   // price_change_percentage: options.price_change_percentage || '1h',
  //   // locale: options.locale || 'en',
  //   // precision: options.precision || 'full',
  // })

  return await client.coins.markets.get({
    vs_currency: options.vs_currency || 'usd',
    order: 'market_cap_desc',
    per_page: options.per_page || 250,
    page: options.page || 1,
    include_tokens: 'top',
    // include_tokens: 'top',
  })
  // const response = await fetch(`https://api.coingecko.com/api/v3/coins/markets?${params.toString()}`, {
  //   method: 'GET',
  //   headers: {
  //     'x-cg-pro-api-key': apiKey,
  //   },
  // })
  // if (!response.ok) {
  //   console.log('response', await response.text())
  //   throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`)
  // }
  // const data = await response.json() as CoinMarketData[]
  // return data
}

const collectMarketsData = async (signal: AbortSignal) => {
  const providerKey = 'coingecko-markets'
  const row = utils.terminal.issue({
    id: providerKey,
    type: terminalRowTypes.SETUP,
  })

  const [provider] = await db.insertProvider({
    key: providerKey,
    name: 'CoinGecko Markets',
    description: 'Market data and token information from CoinGecko Pro API',
  })

  row.createCounter(terminalCounterTypes.TOKEN)
  const section = row.issue(providerKey)

  // Fetch multiple pages to get comprehensive data
  const allCoins: Coins.Markets.MarketGetResponse.MarketGetResponseItem[] = []
  const maxPages = 20 // 250 coins per page = 5000 coins total
  const limiter = promiseLimit(1) // Process one page at a time to respect rate limits

  console.log('Fetching CoinGecko coins markets data...')

  for (let page = 1; page <= maxPages; page++) {
    if (signal.aborted) {
      return
    }

    try {
      console.log(`Fetching page ${page}/${maxPages}...`)
      const coins = await getCoinsMarkets({
        page,
        // per_page: 250,
        // price_change_percentage: '1h,24h,7d,14d,30d,200d,1y'
      })

      if (coins.length === 0) {
        console.log(`No more coins found at page ${page}, stopping...`)
        break
      }

      allCoins.push(...coins)
      row.incrementTotal(terminalCounterTypes.TOKEN, utils.mapToSet.token(coins, (c) => [1, c.id!]))

      // Rate limiting - CoinGecko allows 500 calls/minute for pro API
      await new Promise(resolve => setTimeout(resolve, 500)) // ~400 calls/minute
    } catch (error) {
      console.error(`Error fetching page ${page}:`, error)
      break
    }
  }

  console.log(`Processing ${allCoins.length} coins from CoinGecko markets`)

  // Process coins and store in database
  const tokenLimit = promiseLimit<Coins.Markets.MarketGetResponse.MarketGetResponseItem>(4)
  await tokenLimit.map(allCoins, async (coin) => {
    if (signal.aborted) {
      return
    }

    const task = section.task(`${coin.id}`, {
      id: providerKey,
      type: terminalRowTypes.STORAGE,
      kv: {
        symbol: coin.symbol,
        name: coin.name,
        marketCap: coin.market_cap,
      },
    })

    try {
      // Create a list for this coin
      const [list] = await db.insertList({
        key: `markets-${coin.id}`,
        providerId: provider.providerId,
        networkId: null, // Markets data is cross-chain
      })

      // Store the coin information (without platform-specific addresses since they're not available in markets endpoint)
      if (coin.id && coin.name && coin.symbol) {
        // For markets data, we'll create a generic entry without specific chain addresses
        // This provides the coin metadata and image, but without blockchain addresses
        await db.transaction(async (tx) => {
          await db.fetchImageAndStoreForToken(
            {
              listId: list.listId,
              listTokenOrderId: coin.market_cap_rank || 0,
              uri: coin.image || null,
              originalUri: coin.image || null,
              token: {
                providedId: coin.id!, // Use coin ID as identifier for markets data
                networkId: utils.chainIdToNetworkId(1), // Use Ethereum as default network for market data
                name: coin.name!,
                symbol: coin.symbol!.toUpperCase(),
                decimals: 18, // Default, could be refined with additional API calls
              },
              providerKey,
              signal,
            },
            tx,
          )
        })
      }

      task.complete()
      row.increment(terminalCounterTypes.TOKEN, coin.id || 'unknown')
    } catch (error) {
      console.error(`Error processing coin ${coin.id}:`, error)
      task.complete()
      row.increment('skipped', `${providerKey}-${coin.id || 'unknown'}`)
    }
  })

  row.hideSection(providerKey)
  row.complete()
}

// Note: Platform mapping removed since markets endpoint doesn't provide platform addresses
// For platform-specific addresses, use the individual coin detail endpoint instead

export const collect = async (signal: AbortSignal) => {
  // First collect the existing token lists
  await Promise.all([
    arbitrumOne(signal),
    uniswap(signal),
    zksync(signal),
    collectMarketsData(signal),
  ])
}
