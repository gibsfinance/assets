import { config as dotenvConfig } from 'dotenv'
dotenvConfig()

/**
 * @title Core Utility Functions
 * @notice Collection of utility functions for file handling, RPC interactions, and data processing
 * @dev This module provides core functionality used throughout the application
 */

import * as chains from 'viem/chains'
import config from 'config'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as viem from 'viem'
import { fileURLToPath } from 'url'
import * as types from '@/types'
import _ from 'lodash'
import promiseLimit from 'promise-limit'
import { Spinner } from '@topcli/spinner'
import { Image } from 'knex/types/tables.js'
import { imageMode } from './db/tables'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * @notice Path configuration for file system operations
 * @dev Modified to support configurable output root via OUT_ROOT env var
 */
export const outRoot = process.env.OUT_ROOT || ''

export const root = path.join(__dirname, '..')
export const submodules = path.join(root, 'submodules')
export const images = path.join(root, 'images')
export const links = path.join(root, 'links')

export const paths = {
  root,
  images,
  links,
}

export const pathFromOutRoot = (filePath: string) => {
  return filePath.split(root).join(outRoot)
}

/**
 * @notice Failure logging system with spinner support
 * @dev Modified to suppress certain file-related errors from console output
 * while still tracking them internally
 */
type ConsoleLogParams = Parameters<typeof console.log>
const failures: ConsoleLogParams[] = []
export const failureLog = (...a: ConsoleLogParams) => {
  // Don't log file, extension, or image related failures to console, but still track them
  const isFileFailure = a[0] === 'read file failed' || (typeof a[0] === 'string' && a[0].includes('read file failed'))
  const isExtMissing = a[0] === 'ext missing' || (typeof a[0] === 'string' && a[0].includes('ext missing'))
  const isNoImage = a[0] === 'no img' || (typeof a[0] === 'string' && a[0].includes('no img'))
  const isNoExt = a[0] === 'no ext' || (typeof a[0] === 'string' && a[0].includes('no ext'))
  const shouldSuppress = isFileFailure || isExtMissing || isNoImage || isNoExt

  if (process.env.FAKE_SPINNER && !shouldSuppress) {
    console.log(...a)
  } else {
    failures.push(a)
  }
}

export const printFailures = () => {
  for (const failure of failures) {
    console.log(...failure)
  }
}

export const getFullChainId = (chainId: types.ChainId) => viem.toHex(chainId, { size: 32 })

export const calculateHash = (buffer: Buffer): string => {
  return crypto.createHash('sha256').update(Uint8Array.from(buffer)).digest('hex')
}

export const responseToBuffer = async (res: Response) => {
  if (!res.ok) {
    return null
  }
  return Buffer.from(await res.arrayBuffer())
}

export const sortTokenEntry = (a: types.TokenEntry, b: types.TokenEntry) => {
  return BigInt(a.address) < BigInt(b.address) ? -1 : 1
}

export const limit = promiseLimit(16) as ReturnType<typeof promiseLimit<any>>

export const limitBy = _.memoize(<T>(_key: string, count: number = 16) => {
  return promiseLimit<T>(count) as ReturnType<typeof promiseLimit<T>>
})

/**
 * @notice Chain lookup with custom RPC support
 * @dev Modified to support custom RPC endpoints for specific chains:
 * - Added RPC for Ethereum mainnet from env
 * - Added RPC for PulseChain from env
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

/**
 * @notice Multicall contract reader with enhanced error handling
 * @dev Modified to support:
 * - Optional target address
 * - Per-call ABI override
 * - Automatic failure handling
 */
export const multicallRead = async <T>({
  chain,
  client,
  abi,
  calls,
  target,
}: {
  chain: viem.Chain
  client: ReturnType<typeof viem.createClient>
  abi: viem.Abi
  calls: types.Call[]
  target?: viem.Hex
}) => {
  const multicall = viem.getContract({
    abi: viem.multicall3Abi,
    address: chain.contracts!.multicall3!.address!,
    client,
  })
  const arg = calls.map((call) => ({
    callData: viem.encodeFunctionData({
      abi: call.abi || abi,
      functionName: call.functionName,
      args: call.args || [],
    }),
    allowFailure: call.allowFailure || false,
    target: (call.target || target) as viem.Hex,
  }))
  const reads = await multicall.read.aggregate3([arg])
  return calls.map((call, i) =>
    viem.decodeFunctionResult({
      abi: call.abi || abi,
      functionName: call.functionName,
      data: reads[i].returnData,
    }),
  ) as T
}

/**
 * @notice Generic retry mechanism with exponential backoff
 * @dev Modified to:
 * - Add failure logging
 * - Support configurable delay and attempts
 * - Use timeout utility for delays
 */
const defaultRetryOpts = {
  delay: 3_000,
  attempts: 3,
}

export const retry = async (fn: types.Todo, options = {}) => {
  const opts = {
    ...defaultRetryOpts,
    ...options,
  }
  do {
    try {
      return await fn()
    } catch (err) {
      failureLog(err)
    }
    opts.attempts -= 1
    if (opts.attempts) {
      await timeout(opts.delay).promise
    }
  } while (opts.attempts)
  throw new Error('unable to complete task')
}

export const commonNativeNames = new Set<viem.Hex>([
  viem.zeroAddress,
  viem.getAddress('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
])

export const removedUndesirable = (names: string[]) => {
  return names.filter((name) => name !== '.DS_Store')
}

const spinnerLimit = promiseLimit<any>(4)

const print = (key: string) => {
  let current = 0
  let max = 0
  const log = (w: string) => {
    console.log(`${w} %o %o/%o`, key, current, max)
  }
  const runner = () => {
    log('running')
  }
  log('starting')
  const id = setInterval(runner, 10_000)
  return {
    succeed() {
      clearInterval(id)
      log('success')
    },
    failed() {
      clearInterval(id)
      log('failed')
    },
    incrementMax(amount = 1) {
      max += amount
    },
    incrementCurrent(amount = 1) {
      current += amount
    },
  }
}

type Incrementer = {
  incrementMax: (amount?: number) => void
  incrementCurrent: (amount?: number) => void
}

/**
 * @notice Progress spinner with enhanced functionality
 * @dev Modified to:
 * - Support fake spinner mode for CI/testing
 * - Add progress tracking (current/max)
 * - Include detailed failure logging
 */
export const spinner = async <T>(key: string, fn: ({ incrementMax, incrementCurrent }: Incrementer) => Promise<T>) => {
  return spinnerLimit(async () => {
    const fakeSpinner = process.env.FAKE_SPINNER
    const spinner = fakeSpinner ? print(key) : new Spinner().start(key)
    return await fn({
      incrementMax: (amount = 1) => {
        if (!fakeSpinner) return
        ;(spinner as Incrementer).incrementMax(amount)
      },
      incrementCurrent: (amount = 1) => {
        if (!fakeSpinner) return
        ;(spinner as Incrementer).incrementCurrent(amount)
      },
    })
      .then((res) => {
        spinner.succeed()
        return res
      })
      .catch((err) => {
        failureLog(err)
        spinner.failed()
        throw err
      })
  })
}

export const chainIdToNetworkId = (chainId: types.ChainId, type = 'evm') => toKeccakBytes(`${type}${chainId}`)

type TokenChainInfo = [string, string, number]

/**
 * @notice ERC20 token data reader with fallback support
 * @dev Modified to:
 * - Support both string and bytes32 metadata
 * - Add mustExist flag for required tokens
 * - Handle null bytes in token names/symbols
 */
export const erc20Read = async (
  chain: viem.Chain,
  client: viem.Client,
  target: viem.Hex,
  { skipBytes32 = false, mustExist = false }: { skipBytes32?: boolean; mustExist?: boolean } = {},
) => {
  const calls = [{ functionName: 'name' }, { functionName: 'symbol' }, { functionName: 'decimals' }]
  return await multicallRead<TokenChainInfo>({
    chain,
    client,
    abi: viem.erc20Abi,
    calls,
    target,
  })
    .catch(async (err) => {
      if (skipBytes32) {
        throw err
      }
      return await multicallRead<[viem.Hex, viem.Hex, number]>({
        chain,
        client,
        abi: viem.erc20Abi_bytes32,
        calls,
        target,
      }).then(
        ([name, symbol, decimals]) =>
          [
            viem.fromHex(name, 'string').split('\x00').join(''),
            viem.fromHex(symbol, 'string').split('\x00').join(''),
            decimals,
          ] as TokenChainInfo,
      )
    })
    .catch(() => {
      if (mustExist) {
        throw new Error('unable to read token')
      }
      return ['', '', 18] as TokenChainInfo
    })
}

const folderAccessLimit = promiseLimit<any>(256)

export const folderContents = async (folder: string, fn?: (i: string) => any) => {
  const blockchainFolders = removedUndesirable(await fs.promises.readdir(folder))
  if (!fn) return blockchainFolders
  return await folderAccessLimit.map(blockchainFolders, async (f) => fn(f))
}

export type Timeout = {
  timeoutId: () => NodeJS.Timeout
  promise: Promise<unknown>
}

export const timeout = (ms: number) => {
  let timeoutId: NodeJS.Timeout
  const p = new Promise((resolve) => {
    timeoutId = setTimeout(resolve, ms)
  })
  return {
    timeoutId: () => timeoutId,
    promise: p,
  }
}

export const updateStatus = (message: string) => {
  // Clear the current line and move to the beginning
  process.stdout.clearLine(0)
  process.stdout.cursorTo(0)
  // Write the new message
  process.stdout.write(message)
}

export const toKeccakBytes = (s: string) => viem.keccak256(viem.toBytes(s)).slice(2)

export const directUri = ({ imageHash, ext, mode, uri }: Image) =>
  mode === imageMode.LINK ? uri : imageHash && ext ? `${config.rootURI}/image/direct/${imageHash}${ext}` : undefined

/**
 * @notice Result caching utility with TTL
 * @dev Added to improve performance for expensive operations
 * Features:
 * - Configurable cache duration
 * - Automatic cache invalidation
 * - Promise result caching
 */
export const cacheResult = <T>(worker: () => Promise<T>, duration = 1000 * 60 * 60) => {
  let cached: null | {
    timestamp: number
    result: Promise<T>
  } = null

  return _.wrap(worker, (fn) => {
    if (cached) {
      const { timestamp, result } = cached
      if (timestamp > Date.now() - duration) {
        return result
      }
    }
    cached = {
      timestamp: Date.now(),
      result: fn(),
    }
    return cached.result
  })
}

/**
 * @notice Memoized viem public client factory
 * @dev Added to provide consistent client instances with optimal settings:
 * - Multicall batching enabled
 * - 32 calls per batch
 * - No wait time between batches
 */
export const publicClient = _.memoize((chain: viem.Chain) => {
  return viem.createPublicClient({
    chain,
    transport: viem.http(),
    batch: {
      multicall: {
        batchSize: 32,
        wait: 0,
      },
    },
  }) as viem.PublicClient
})
