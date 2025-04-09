/**
 * @title PulseChain Token List Collector
 * @notice Collects token information from PulseChain assets repository
 * @dev Changes from original version:
 * 1. Replaced spinner with detailed status updates
 * 2. Added progress tracking for configs and pieces
 * 3. Improved error handling for token reading
 * 4. Added support for testnet variants
 */

import * as db from '@/db'
import * as utils from '@/utils'
import * as fs from 'fs'
import _ from 'lodash'
import * as path from 'path'
import promiseLimit from 'promise-limit'
import * as viem from 'viem'
import { pulsechain, pulsechainV4 } from 'viem/chains'
import type { StatusProps } from '../components/Status'
import { updateStatus } from '../utils/status'

/**
 * @notice Configuration for mainnet and testnet token collection
 * @dev Changes:
 * 1. Added separate configs for mainnet and testnet
 * 2. Enhanced fetchConfig with mustExist and skipBytes32 flags
 * 3. Added descriptive names and keys for each network
 */
const configs = [
  {
    list: {
      default: true,
      key: 'repo',
      name: 'pls369',
      description: 'a grass roots list curated by pulsechain users',
    },
    fetchConfig: {
      mustExist: true,
      skipBytes32: false,
    },
    chain: pulsechain,
  },
  {
    list: {
      default: false,
      key: 'repo-testnet',
      name: 'v4pls943',
      description: 'a grass roots list curated by pulsechainV4 users',
    },
    fetchConfig: {
      mustExist: true,
      skipBytes32: true,
    },
    chain: pulsechainV4,
  },
] as const

type Walker = (target: string, doWalk: () => Promise<string[]>) => Promise<string[]>

export const walkFor = async (start: string, fn: Walker): Promise<string[]> => {
  const stats = await fs.promises.readdir(start)
  const limiter = promiseLimit<string>(8)
  const filtered = await limiter.map(stats, (file) => {
    const f = path.join(start, file)
    return fn(f, () => walkFor(f, fn))
  })
  return _.flattenDeep(filtered)
}

/**
 * @notice Main collection function that processes PulseChain assets
 * @dev Changes:
 * 1. Added phase-specific status messages
 * 2. Implemented config processing progress tracking
 * 3. Added piece processing progress tracking
 * 4. Enhanced testnet variant handling with clear status updates
 */
export const collect = async () => {
  updateStatus({
    provider: 'pls369',
    message: 'Scanning asset directory...',
    phase: 'setup',
  } satisfies StatusProps)

  const walkPath = path.join(utils.root, 'submodules', 'pulsechain-assets', 'blockchain', 'pulsechain', 'assets')
  const infoFiles = await walkFor(walkPath, async (file, walker) => {
    const stat = await fs.promises.stat(file)
    if (stat.isDirectory()) {
      return walker()
    }
    if (file.includes('.DS_Store')) return []

    if (path.extname(file) !== '.json') {
      return [file]
    }
    return []
  })

  const paths = infoFiles.map((file) => file.split(`${walkPath}`).join(''))
  const pieces = _(paths)
    .map((p) => {
      const addr = p.slice(1, 43)
      if (addr !== '0xA1077a294dDE1B09bB078844df40758a5D0f9a27') {
        return null
      }
      if (!viem.isAddress(addr)) return null
      return {
        address: viem.getAddress(addr),
        path: p,
        fullPath: path.join(walkPath, p),
      }
    })
    .compact()
    .value()

  updateStatus({
    provider: 'pls369',
    message: `Found ${pieces.length} valid assets to process`,
    phase: 'setup',
  } satisfies StatusProps)

  const [provider] = await db.insertProvider({
    key: 'pls369',
    name: 'PLS369',
    description: 'a grass roots list curated by pulsechain users',
  })

  let configIndex = 0
  for (const { list, chain, fetchConfig } of configs) {
    configIndex++
    updateStatus({
      provider: 'pls369',
      message: `Processing config for chain ${chain.id} (${list.name})`,
      current: configIndex,
      total: configs.length,
      phase: 'processing',
    } satisfies StatusProps)

    const client = viem.createClient({
      chain: chain,
      transport: viem.http(),
    })
    const network = await db.insertNetworkFromChainId(chain.id)
    const [dbList] = await db.insertList({
      providerId: provider.providerId,
      networkId: network.networkId,
      ...list,
    })

    let processedPieces = 0
    for (const piece of pieces) {
      processedPieces++
      updateStatus({
        provider: 'pls369',
        message: `Processing token at ${piece.address}`,
        current: processedPieces,
        total: pieces.length,
        phase: 'processing',
      } satisfies StatusProps)

      const response = await utils.erc20Read(chain, client, piece.address, fetchConfig).catch(() => null)

      if (!response) {
        updateStatus({
          provider: 'pls369',
          message: `Failed to read token at ${piece.address}`,
          current: processedPieces,
          total: pieces.length,
          phase: 'processing',
        } satisfies StatusProps)
        continue
      }

      const [name, symbol, decimals] = response
      const path = piece.fullPath.replace('hhttps://', 'https://')

      updateStatus({
        provider: 'pls369',
        message: `Storing token ${symbol} (${name})`,
        current: processedPieces,
        total: pieces.length,
        phase: 'storing',
      } satisfies StatusProps)

      await db.fetchImageAndStoreForToken({
        listId: dbList.listId,
        uri: path,
        originalUri: path,
        providerKey: provider.key,
        token: {
          name,
          symbol,
          decimals,
          networkId: network.networkId,
          providedId: piece.address,
        },
      })

      if (chain.id !== 369 || piece.address !== '0xA1077a294dDE1B09bB078844df40758a5D0f9a27') {
        continue
      }

      updateStatus({
        provider: 'pls369',
        message: `Processing testnet variants for ${symbol}`,
        current: processedPieces,
        total: pieces.length,
        phase: 'processing',
      } satisfies StatusProps)

      const testNetwork = await db.insertNetworkFromChainId(pulsechainV4.id)
      const [dbList2] = await db.insertList({
        providerId: provider.providerId,
        networkId: testNetwork.networkId,
        ...list,
      })

      const testnetAddresses = ['0x70499adEBB11Efd915E3b69E700c331778628707', viem.zeroAddress]
      for (const testAddress of testnetAddresses) {
        updateStatus({
          provider: 'pls369',
          message: `Storing testnet variant at ${testAddress}`,
          current: processedPieces,
          total: pieces.length,
          phase: 'storing',
        } satisfies StatusProps)

        await db.fetchImageAndStoreForToken({
          listId: dbList2.listId,
          uri: path,
          originalUri: path,
          providerKey: provider.key,
          token: {
            name,
            symbol,
            decimals,
            networkId: testNetwork.networkId,
            providedId: testAddress,
          },
        })
      }

      updateStatus({
        provider: 'pls369',
        message: 'Storing mainnet zero address variant',
        current: processedPieces,
        total: pieces.length,
        phase: 'storing',
      } satisfies StatusProps)

      await db.fetchImageAndStoreForToken({
        listId: dbList.listId,
        uri: path,
        originalUri: path,
        providerKey: provider.key,
        token: {
          name,
          symbol,
          decimals,
          networkId: network.networkId,
          providedId: viem.zeroAddress,
        },
      })

      updateStatus({
        provider: 'pls369',
        message: 'Storing network icon',
        current: processedPieces,
        total: pieces.length,
        phase: 'storing',
      } satisfies StatusProps)

      await db.fetchImageAndStoreForNetwork({
        chainId: pulsechainV4.id,
        uri: path,
        originalUri: path,
        providerKey: provider.key,
      })
    }
  }

  updateStatus({
    provider: 'pls369',
    message: 'Collection complete!',
    phase: 'complete',
  } satisfies StatusProps)
}
