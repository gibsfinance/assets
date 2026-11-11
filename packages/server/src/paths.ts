import * as path from 'path'
import { fileURLToPath } from 'url'

export const __filename = fileURLToPath(import.meta.url)
export const __dirname = path.dirname(__filename)

export const root = path.join(__dirname, '..')
export const src = __dirname
/**
 * Where the vendored artwork repositories live. `SUBMODULES_DIRECTORY` moves them, so a
 * deployment can keep them on a volume that outlives the container and lets the
 * collector refresh them in place (see `submodule-refresh.ts`).
 */
export const submodules = process.env['SUBMODULES_DIRECTORY']
  ? path.resolve(process.env['SUBMODULES_DIRECTORY'])
  : path.join(root, '..', '..', 'submodules')
export const images = path.join(root, 'images')
export const links = path.join(root, 'links')
export const harvested = path.join(src, 'harvested')
export const harvestedCoingecko = path.join(harvested, 'coingecko')
export const harvestedCoingeckoAssetPlatforms = path.join(harvestedCoingecko, 'asset_platforms.json')
