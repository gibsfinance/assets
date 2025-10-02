import * as remoteTokenList from './remote-tokenlist'
import * as db from '../db'
import _ from 'lodash'
import * as utils from '../utils'
import { terminalCounterTypes, terminalLogTypes, terminalRowTypes } from '../log/types'
import { limitBy, timeout } from '@gibs/utils'

const limit = limitBy<AssetPlatform>(`coingecko-platforms`, 1)

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

export const collect = async (signal: AbortSignal) => {
  const row = utils.terminal.issue({
    type: terminalRowTypes.SETUP,
    id: 'coingecko',
  })
  const section = row.issue('coingecko')
  if (!process.env.COINGECKO_API_KEY) {
    console.log('COINGECKO_API_KEY is not set. skipping coingecko collection')
    row.complete()
    row.increment('skipped', 'coingecko')
    return
  }

  // const assetPlatforms = await processAssetPlatforms()
  const platforms = await db.cachedJSONRequest<AssetPlatform[]>(
    `https://api.coingecko.com/api/v3/asset_platforms?${qs}`,
    `https://api.coingecko.com/api/v3/asset_platforms?${qs}`,
    { signal },
  )
  row.createCounter(terminalCounterTypes.NETWORK)
  const platformIds = new Set(_(platforms).map(platform => platform.id).compact().value())
  row.incrementTotal(terminalCounterTypes.NETWORK, platformIds)
  await limit.map(platforms, async (platform) => {
    if (signal.aborted) {
      return
    }
    if (!platform.chain_identifier) {
      return
    }
    if (typeof platform.chain_identifier !== 'number') {
      return
    }
    const listKey = platform.id
    const collect = remoteTokenList.collect({
      providerKey: 'coingecko',
      listKey,
      tokenList: `https://api.coingecko.com/api/v3/token_lists/${listKey}/all.json?${qs}`,
      row: section,
    })
    let retries = 0
    while (true) {
      try {
        await collect(signal)
      } catch (err) {
        if ((err as Error).message.includes('429 Too Many Requests')) {
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
        console.log(err)
        throw err
      }
    }
  })

  row.complete()
}

/**
 * Process asset platforms and validate chain identifiers
 * Logs platforms with invalid chain_identifiers and returns only valid ones
 */
// export const processAssetPlatforms = async () => {
//   try {
//     // Read the asset platforms file
//     const assetPlatformsPath = path.join(root, 'src', 'harvested', 'coingecko', 'asset_platforms.json')
//     const fileData = await fs.readFile(assetPlatformsPath, 'utf-8')
//     const platforms: AssetPlatform[] = JSON.parse(fileData)

//     console.log(`📊 Processing ${platforms.length} asset platforms...`)

//     const validPlatforms: AssetPlatform[] = []
//     const invalidPlatforms: AssetPlatform[] = []

//     // Loop through each platform
//     for (const platform of platforms) {
//       // Check if chain_identifier is not a number
//       if (platform.chain_identifier === null) continue
//       if (typeof platform.chain_identifier !== 'number') {
//         console.log(`⚠️  Invalid chain_identifier for platform: ${platform.id} (${platform.name}) - chain_identifier: ${platform.chain_identifier}`)
//         invalidPlatforms.push(platform)
//         continue
//       }

//       validPlatforms.push(platform)
//     }

//     // Summary
//     // console.log(`\n📈 Summary:`)
//     // console.log(`  ✅ Valid platforms: ${validPlatforms.length}`)
//     // console.log(`  ⚠️  Invalid platforms: ${invalidPlatforms.length}`)

//     // Show platforms with images
//     // const platformsWithImages = validPlatforms.filter(p => p.image.large || p.image.small || p.image.thumb)
//     // console.log(`  🖼️  Platforms with images: ${platformsWithImages.length}`)

//     return { validPlatforms, invalidPlatforms }

//   } catch (error) {
//     console.error(`❌ Error processing asset platforms: ${error}`)
//     throw error
//   }
// }

// // https://app.geckoterminal.com/api/p1/networks?fields%5Bnetwork%5D=name%2Cidentifier%2Cimage_url%2Cis_new&show_for_sidebar=1
