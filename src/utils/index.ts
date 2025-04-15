import { config as dotenvConfig } from 'dotenv'
dotenvConfig()

Error.stackTraceLimit = Infinity

import * as chains from 'viem/chains'
import config from 'config'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as viem from 'viem'
import * as types from '@/types'
import _ from 'lodash'
import promiseLimit from 'promise-limit'
import { Spinner } from '@topcli/spinner'
import { Image } from 'knex/types/tables.js'
import { imageMode } from '@/db/tables'
import { createTerminal } from '@/log/App'
import * as paths from '@/paths'

/**
 * Failure logging system with spinner support
 */
type ConsoleLogParams = Parameters<typeof console.log>
const failures: ConsoleLogParams[] = []
export const failureLog = (...a: ConsoleLogParams) => {
  // Don't log file, extension, or image related failures to console, but still track them
  // const isFileFailure = a[0] === 'read file failed' || (typeof a[0] === 'string' && a[0].includes('read file failed'))
  // const isExtMissing = a[0] === 'ext missing' || (typeof a[0] === 'string' && a[0].includes('ext missing'))
  // const isNoImage = a[0] === 'no img' || (typeof a[0] === 'string' && a[0].includes('no img'))
  // const isNoExt = a[0] === 'no ext' || (typeof a[0] === 'string' && a[0].includes('no ext'))
  // const shouldSuppress = isFileFailure || isExtMissing || isNoImage || isNoExt

  // if (process.env.FAKE_SPINNER && !shouldSuppress) {
  //   console.log(...a)
  // } else {
  // }
  failures.push(a)
}

export const printFailures = () => {
  fs.writeFileSync(path.join(paths.root, 'failures.json'), JSON.stringify(failures, null, 2))
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

export const limitBy = _.memoize(<T>(_key: string, count = 16) => {
  return promiseLimit<T>(count) as ReturnType<typeof promiseLimit<T>>
})

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

/**
 * Multicall contract reader with enhanced error handling
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
 * Generic retry mechanism with exponential backoff
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
 * Progress spinner with enhanced functionality
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
 * ERC20 token data reader with fallback support
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
    clear: () => clearTimeout(timeoutId),
  }
}

export const toKeccakBytes = (s: string) => viem.keccak256(viem.toBytes(s)).slice(2)

export const directUri = ({ imageHash, ext, mode, uri }: Image) =>
  mode === imageMode.LINK ? uri : imageHash && ext ? `${config.rootURI}/image/direct/${imageHash}${ext}` : undefined

/**
 * Result caching utility with TTL
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

const defaultBatchSettings = {
  multicall: {
    batchSize: 32,
    wait: 0,
  },
}

/**
 * Memoized viem public client factory
 */
export const chainToPublicClient = _.memoize((chain: viem.Chain) => {
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

export const terminal = createTerminal()
