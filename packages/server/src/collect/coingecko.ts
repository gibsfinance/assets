import * as remoteTokenList from './remote-tokenlist'
import * as db from '../db'
import _ from 'lodash'
import * as utils from '../utils'
import { terminalCounterTypes, terminalLogTypes, terminalRowTypes } from '../log/types'
import { failureLog, limitBy, timeout } from '@gibs/utils'
import { limitByTime } from '@gibs/utils/fetch'
import { BaseCollector, DiscoveryManifest } from './base-collector'

const limit = limitBy<AssetPlatform>(`coingecko-platforms`, 1)
const rateLimiter = limitByTime(1_500)

type AssetPlatform = {
  id: string
  chain_identifier: number | null
  name: string
  shortname: string
  native_coin_id: string
  image: {
    thumb: string | null
    small: string | null
    large: string | null
  }
  network: {
    id: number
    isNetworkImage: boolean
  }
}

const qs = 'x_cg_demo_api_key=' + process.env.COINGECKO_API_KEY
const providerKey = 'coingecko'

/**
 * Two-phase collector for CoinGecko asset platforms.
 * Phase 1 (discover): gets platform list, creates provider + per-platform lists.
 * Phase 2 (collect): processes tokens for each platform.
 */
class CoinGeckoCollector extends BaseCollector {
  readonly key = 'coingecko'

  private platforms: AssetPlatform[] = []

  async discover(signal: AbortSignal): Promise<DiscoveryManifest> {
    if (!process.env.COINGECKO_API_KEY) {
      failureLog('COINGECKO_API_KEY is not set. skipping coingecko collection')
      return []
    }

    const platforms = await db.cachedJSONRequest<AssetPlatform[]>(
      `https://api.coingecko.com/api/v3/asset_platforms?${qs}`,
      signal,
      `https://api.coingecko.com/api/v3/asset_platforms?${qs}`,
    )

    // Filter to platforms with valid chain identifiers
    const validPlatforms = platforms.filter((p) => p.chain_identifier && typeof p.chain_identifier === 'number')

    // Create provider
    const [provider] = await db.insertProvider({
      key: providerKey,
      name: 'CoinGecko',
    })

    // Create per-platform lists via remote-tokenlist pattern (each platform is a list)
    const lists: { listKey: string }[] = []
    for (const platform of validPlatforms) {
      const listKey = platform.id
      await db.insertList({
        providerId: provider.providerId,
        key: listKey,
      })
      lists.push({ listKey })
    }

    this.platforms = platforms

    return [{ providerKey, lists }]
  }

  async collect(signal: AbortSignal): Promise<void> {
    const row = utils.terminal.issue({
      type: terminalRowTypes.SETUP,
      id: providerKey,
    })
    try {
      const section = row.issue(providerKey)
      if (!process.env.COINGECKO_API_KEY) {
        failureLog('COINGECKO_API_KEY is not set. skipping coingecko collection')
        row.increment('skipped', providerKey)
        return
      }

      row.createCounter(terminalCounterTypes.NETWORK)
      const platformIds = new Set(
        _(this.platforms)
          .map((platform) => platform.id)
          .compact()
          .value(),
      )
      row.incrementTotal(terminalCounterTypes.NETWORK, platformIds)
      await limit.map(this.platforms, async (platform) => {
        if (signal.aborted) return
        if (!platform.chain_identifier) return
        if (typeof platform.chain_identifier !== 'number') return

        const listKey = platform.id
        const cacheKey = `https://api.coingecko.com/api/v3/token_lists/${listKey}/all.json?${qs}`
        const isCached = await db.getCachedRequest(cacheKey)
        if (!isCached) {
          await rateLimiter()
        }
        const collect = remoteTokenList.collect({
          providerKey,
          listKey,
          tokenList: `https://api.coingecko.com/api/v3/token_lists/${listKey}/all.json?${qs}`,
          row: section,
        })
        let retries = 0
        for (;;) {
          try {
            await collect(signal)
          } catch (err) {
            if (
              (err as Error).message.includes('429 Too Many Requests') ||
              (err as Error).message.includes('Throttled')
            ) {
              retries++
              await timeout(5000 * retries).promise
              if (retries > 5) {
                throw err
              }
              continue
            }
            if ((err as Error).message === 'HTTP error! status: 404 Not Found') {
              row.increment(terminalLogTypes.EROR, new Set([listKey]))
              return
            }
            failureLog('%o', err)
            throw err
          }
          break
        }
      })
    } finally {
      row.complete()
    }
  }
}

export default CoinGeckoCollector

export const collect = async (signal: AbortSignal) => {
  const collector = new CoinGeckoCollector()
  await collector.discover(signal)
  await collector.collect(signal)
}
