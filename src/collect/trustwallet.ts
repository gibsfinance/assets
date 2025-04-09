/**
 * @title Trust Wallet Token List Collector
 * @notice Collects token information and images from Trust Wallet's blockchain assets
 * @dev Changes from original version:
 * 1. Replaced spinner with direct console status updates
 * 2. Added progress tracking for both folders and assets
 * 3. Improved error handling with continue instead of return in asset processing
 * 4. Added clear status messages for each operation phase
 * 5. Fixed variable naming conflicts with assets/assetData
 */

import * as db from '@/db'
import * as types from '@/types'
import * as utils from '@/utils'
import * as fs from 'fs'
import { Image } from 'knex/types/tables'
import * as path from 'path'
import * as viem from 'viem'
import type { StatusProps } from '../components/Status'
import { updateStatus } from '../utils/status'

const providerKey = 'trustwallet'
const blockchainsRoot = path.join(utils.root, 'submodules', 'trustwallet', 'blockchains')
const assetsFolder = 'assets'

/**
 * @notice Main collection function that processes all blockchain folders
 * @dev Changes:
 * 1. Added folder processing progress tracking
 * 2. Implemented status updates for each blockchain folder
 * 3. Added completion message with newline
 */
export const collect = async () => {
  try {
    updateStatus({
      provider: providerKey,
      message: 'Reading blockchain folders...',
      phase: 'setup',
    } satisfies StatusProps)

    const blockchainFolders = utils.removedUndesirable(await fs.promises.readdir(blockchainsRoot))
    let processedFolders = 0

    for (const folder of blockchainFolders) {
      processedFolders++
      updateStatus({
        provider: providerKey,
        message: `Processing blockchain: ${folder}`,
        current: processedFolders,
        total: blockchainFolders.length,
        phase: 'processing',
      } satisfies StatusProps)

      try {
        const f = path.join(blockchainsRoot, folder, assetsFolder)
        const assets = await fs.promises.readdir(f).catch(() => [])
        await entriesFromAssets(folder, utils.removedUndesirable(assets))
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        updateStatus({
          provider: providerKey,
          message: `Failed to process blockchain ${folder}: ${errorMessage}`,
          current: processedFolders,
          total: blockchainFolders.length,
          phase: 'processing',
        } satisfies StatusProps)
      }
    }

    updateStatus({
      provider: providerKey,
      message: 'Collection complete!',
      phase: 'complete',
    } satisfies StatusProps)
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    updateStatus({
      provider: providerKey,
      message: `Fatal error: ${errorMessage}`,
      phase: 'complete',
    } satisfies StatusProps)
    throw error
  }
}

/**
 * @notice Loads and parses token info and logo path from a directory
 * @param p The path to the directory containing info.json and logo.png
 * @return Promise<[Info, string]> Tuple of parsed info and logo path
 */
const load = async (p: string) => {
  return await Promise.all([
    fs.promises.readFile(path.join(p, 'info.json')).then((info) => JSON.parse(info.toString()) as Info),
    path.join(p, 'logo.png'),
  ])
}

type Link = {
  name: string
  url: string
}

type Info = types.TokenEntry & {
  website?: string
  description?: string
  explorer?: string
  research?: string
  coin_type?: number
  status?: string
  rpc_url?: string
  tags?: string[]
  links: Link[]
}

/**
 * @notice Processes assets for a specific blockchain and stores them in the database
 * @dev Changes:
 * 1. Added detailed status updates for each phase
 * 2. Implemented asset processing progress tracking
 * 3. Improved error handling for asset loading
 * 4. Fixed naming conflicts in asset processing loop
 * 5. Enhanced chainId detection with RPC fallback
 * @param blockchainKey The blockchain identifier
 * @param assets Array of asset addresses to process
 */
const entriesFromAssets = async (blockchainKey: string, assets: string[]) => {
  try {
    updateStatus({
      provider: providerKey,
      message: `Setting up for ${blockchainKey}...`,
      phase: 'setup',
    } satisfies StatusProps)

    const info = path.join(blockchainsRoot, blockchainKey, 'info')
    const [networkInfo, networkLogoPath] = await load(info)
    const tokenlistPath = path.join(blockchainsRoot, blockchainKey, 'tokenlist.json')
    const list = await fs.promises.readFile(tokenlistPath).catch(() => null)

    if (!list) {
      updateStatus({
        provider: providerKey,
        message: `No token list found for ${blockchainKey}`,
        phase: 'complete',
      } satisfies StatusProps)
      return
    }

    const tokenList = JSON.parse(list.toString()) as types.TokenList
    let chainId = networkInfo.coin_type || tokenList.tokens?.[0]?.chainId

    if (!chainId && networkInfo.rpc_url) {
      updateStatus({
        provider: providerKey,
        message: `Checking chain ID from RPC for ${blockchainKey}...`,
        phase: 'setup',
      } satisfies StatusProps)

      const client = viem.createPublicClient({
        transport: viem.http(networkInfo.rpc_url),
        batch: { multicall: { batchSize: 32, wait: 0 } },
      })
      chainId = await client.getChainId()
    }

    if (!chainId) {
      updateStatus({
        provider: providerKey,
        message: `No chain ID found for ${blockchainKey}`,
        phase: 'complete',
      } satisfies StatusProps)
      return
    }

    updateStatus({
      provider: providerKey,
      message: `Setting up provider and lists for ${blockchainKey}...`,
      phase: 'setup',
    } satisfies StatusProps)

    const [provider] = await db.insertProvider({
      key: providerKey,
      name: 'Trust Wallet',
    })

    const [trustwalletList] = await db.insertList({
      key: 'wallet',
      default: true,
      providerId: provider.providerId,
    })

    const key = `wallet-${blockchainKey}`
    const network = await db.insertNetworkFromChainId(chainId)
    const [networkList] = await db.insertList({
      providerId: provider.providerId,
      networkId: network.networkId,
      name: key,
      key,
    })

    updateStatus({
      provider: providerKey,
      message: `Storing network logo for ${blockchainKey}...`,
      phase: 'storing',
    } satisfies StatusProps)

    const res = await db.fetchImageAndStoreForList({
      listId: networkList.listId,
      uri: networkLogoPath,
      originalUri: networkLogoPath,
      providerKey,
    })

    if (res) {
      const resWImage = res as { image: Image }
      await db.fetchImageAndStoreForList({
        listId: trustwalletList.listId,
        uri: resWImage.image ? resWImage.image.content : null,
        originalUri: networkLogoPath,
        providerKey,
      })
    }

    let processedAssets = 0
    const totalAssets = assets.length

    for (const asset of assets) {
      processedAssets++
      updateStatus({
        provider: providerKey,
        message: `Processing asset: ${asset}`,
        current: processedAssets,
        total: totalAssets,
        phase: 'processing',
      } satisfies StatusProps)

      const folder = path.join(blockchainsRoot, blockchainKey, assetsFolder, asset)
      const assetData = await load(folder).catch(() => null)

      if (!assetData) {
        updateStatus({
          provider: providerKey,
          message: `Failed to load asset data for ${asset}`,
          current: processedAssets,
          total: totalAssets,
          phase: 'processing',
        } satisfies StatusProps)
        continue
      }

      const [info, logoPath] = assetData
      const address = asset as viem.Hex

      for (const list of [networkList, trustwalletList]) {
        const file = await db.fetchImage(logoPath, networkList.key)
        if (!file) {
          updateStatus({
            provider: providerKey,
            message: `No image found for ${info.symbol}`,
            current: processedAssets,
            total: totalAssets,
            phase: 'processing',
          } satisfies StatusProps)
          continue
        }

        updateStatus({
          provider: providerKey,
          message: `Storing token: ${info.symbol}`,
          current: processedAssets,
          total: totalAssets,
          phase: 'storing',
        } satisfies StatusProps)

        await db.fetchImageAndStoreForToken({
          listId: list.listId,
          uri: file,
          originalUri: logoPath,
          providerKey,
          token: {
            providedId: address,
            networkId: network.networkId,
            name: info.name,
            symbol: info.symbol,
            decimals: info.decimals,
          },
        })
      }
    }

    updateStatus({
      provider: providerKey,
      message: `Completed processing ${blockchainKey}`,
      phase: 'complete',
    } satisfies StatusProps)
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    updateStatus({
      provider: providerKey,
      message: `Error processing ${blockchainKey}: ${errorMessage}`,
      phase: 'complete',
    } satisfies StatusProps)
    throw error
  }
}
