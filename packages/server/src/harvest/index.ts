import * as fs from 'fs'
import * as paths from '@/paths'

const getPlatforms = async (key: string) => {
  const response = await fetch(`https://api.coingecko.com/api/v3/asset_platforms?x_cg_demo_api_key=${key}`)
  const data = await response.json()
  return data
}
export const main = async ({ coingeckoApiKey }: { coingeckoApiKey: string }) => {
  const platforms = await getPlatforms(coingeckoApiKey)
  await fs.promises.writeFile(paths.harvestedCoingeckoAssetPlatforms, JSON.stringify(platforms, null, 2))
}
