import * as path from 'path'
import { fileURLToPath } from 'url'

export const __filename = fileURLToPath(import.meta.url)
export const __dirname = path.dirname(__filename)

export const root = path.join(__dirname, '..')
export const src = __dirname
export const submodules = path.join(root, '..', '..', 'submodules')
export const images = path.join(root, 'images')
export const links = path.join(root, 'links')
export const harvested = path.join(src, 'harvested')
export const harvestedCoingecko = path.join(harvested, 'coingecko')
export const harvestedCoingeckoAssetPlatforms = path.join(harvestedCoingecko, 'asset_platforms.json')
