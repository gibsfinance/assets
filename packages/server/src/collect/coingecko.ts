import * as remoteTokenList from './remote-tokenlist'
import * as fs from 'fs/promises'
import * as path from 'path'
import { root } from '../paths'

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

export const collect = async (signal: AbortSignal) => {
  const assetPlatforms = await processAssetPlatforms()

  for (const validPlatform of assetPlatforms.validPlatforms) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    const listKey = validPlatform.id
    const collect = remoteTokenList.collect({
      providerKey: 'coingecko',
      listKey,
      tokenList: `https://api.coingecko.com/api/v3/token_lists/${listKey}/all.json?x_cg_demo_api_key=${process.env.COINGECKO_API_KEY}`,
    })
    await collect(signal).catch((err) => {
      // console.error(`❌ Error collecting ${listKey}: ${err}`)
    })
  }
}

/**
 * Process asset platforms and validate chain identifiers
 * Logs platforms with invalid chain_identifiers and returns only valid ones
 */
export const processAssetPlatforms = async () => {
  try {
    // Read the asset platforms file
    const assetPlatformsPath = path.join(root, 'src', 'harvested', 'coingecko', 'asset_platforms.json')
    const fileData = await fs.readFile(assetPlatformsPath, 'utf-8')
    const platforms: AssetPlatform[] = JSON.parse(fileData)

    console.log(`📊 Processing ${platforms.length} asset platforms...`)

    const validPlatforms: AssetPlatform[] = []
    const invalidPlatforms: AssetPlatform[] = []

    // Loop through each platform
    for (const platform of platforms) {
      // Check if chain_identifier is not a number
      if (platform.chain_identifier === null) continue
      if (typeof platform.chain_identifier !== 'number') {
        console.log(`⚠️  Invalid chain_identifier for platform: ${platform.id} (${platform.name}) - chain_identifier: ${platform.chain_identifier}`)
        invalidPlatforms.push(platform)
        continue
      }

      validPlatforms.push(platform)
    }

    // Summary
    console.log(`\n📈 Summary:`)
    console.log(`  ✅ Valid platforms: ${validPlatforms.length}`)
    console.log(`  ⚠️  Invalid platforms: ${invalidPlatforms.length}`)

    // Show platforms with images
    const platformsWithImages = validPlatforms.filter(p => p.image.large || p.image.small || p.image.thumb)
    console.log(`  🖼️  Platforms with images: ${platformsWithImages.length}`)

    return { validPlatforms, invalidPlatforms }

  } catch (error) {
    console.error(`❌ Error processing asset platforms: ${error}`)
    throw error
  }
}
