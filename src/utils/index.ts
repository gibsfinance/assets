import { config as dotenvConfig } from 'dotenv'
dotenvConfig()

Error.stackTraceLimit = Infinity

import * as chains from 'viem/chains'
import config from 'config'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as viem from 'viem'
import _ from 'lodash'
import promiseLimit from 'promise-limit'
import { failures, type ChainId } from '@gibs/utils'

import type { TokenEntry } from '@/types'
import { Image } from 'knex/types/tables.js'
import { imageMode } from '@/db/tables'
import { createTerminal } from '@/log/App'
import * as paths from '@/paths'

export const printFailures = () => {
  const failuresPath = path.join(paths.root, 'failures.json')
  console.log(failuresPath)
  fs.writeFileSync(failuresPath, JSON.stringify(failures, null, 2))
}

export const getFullChainId = (chainId: ChainId) => viem.toHex(chainId, { size: 32 })

export const calculateHash = (buffer: Buffer): string => {
  return crypto.createHash('sha256').update(Uint8Array.from(buffer)).digest('hex')
}

export const sortTokenEntry = (a: TokenEntry, b: TokenEntry) => {
  return BigInt(a.address) < BigInt(b.address) ? -1 : 1
}

/**
 * Chain lookup with custom RPC support
 */
export const findChain = (chainId: number) => {
  const chain = Object.values(chains).find((chain) => chain.id === chainId) as viem.Chain
  if (!chain) {
    return null
  }

  // Get RPC URLs from environment variables
  const envKey = `RPC_${chainId}`
  const rpcUrls = process.env[envKey]?.split(',').filter(Boolean)

  if (rpcUrls?.length) {
    return _.set(_.cloneDeep(chain), 'rpcUrls.default.http', rpcUrls)
  }

  return chain
}

export const commonNativeNames = new Set<viem.Hex>([
  viem.zeroAddress,
  viem.getAddress('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
])

export const removedUndesirable = (names: string[]) => {
  return names.filter((name) => name !== '.DS_Store')
}

export const chainIdToNetworkId = (chainId: ChainId, type = 'evm') => toKeccakBytes(`${type}${chainId}`)

const folderAccessLimit = promiseLimit<any>(256)

export const folderContents = async (folder: string, fn?: (i: string) => any) => {
  const blockchainFolders = removedUndesirable(await fs.promises.readdir(folder))
  if (!fn) return blockchainFolders
  return await folderAccessLimit.map(blockchainFolders, async (f) => fn(f))
}

export const toKeccakBytes = (s: string) => viem.keccak256(viem.toBytes(s)).slice(2)

export const directUri = ({ imageHash, ext, mode, uri }: Image) =>
  mode === imageMode.LINK ? uri : imageHash && ext ? `${config.rootURI}/image/direct/${imageHash}${ext}` : undefined

const defaultBatchSettings = {
  multicall: {
    batchSize: 32,
    wait: 0,
  },
}

/**
 * Memoized viem public client factory
 */
export const chainToPublicClient = _.memoize((chain: viem.Chain): viem.PublicClient => {
  let transport = viem.http()
  if (chain.id === 250) {
    transport = viem.http('https://fantom-rpc.publicnode.com')
  }
  return viem.createPublicClient({
    chain,
    transport,
    batch: defaultBatchSettings,
  }) as viem.PublicClient
})

// main terminal section
export const terminal = createTerminal().issue('main', Infinity)
