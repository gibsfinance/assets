import * as chains from 'viem/chains'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as viem from 'viem'
import { fileURLToPath } from 'url'
import * as types from '@/types'
import _ from 'lodash'
import promiseLimit from 'promise-limit'
import { Spinner } from '@topcli/spinner'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const outRoot = process.env.OUT_ROOT || ''

export const root = path.join(__dirname, '..')
export const submodules = path.join(root, 'submodules')
console.log('submodules %o', submodules)
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

type ConsoleLogParams = Parameters<typeof console.log>
const failures: ConsoleLogParams[] = []
export const failureLog = (...a: ConsoleLogParams) => {
  failures.push(a)
}

export const printFailures = () => {
  for (const failure of failures) {
    console.log(...failure)
  }
}

export const getFullChainId = (chainId: types.ChainId) => viem.toHex(chainId, { size: 32 })

export const calculateHash = (buffer: Buffer): string => {
  return crypto.createHash('sha256').update(buffer).digest('hex')
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

export const limit = promiseLimit<any>(256)

export const findChain = (chainId: number) => {
  const chain = Object.values(chains).find((chain) => chain.id === chainId) as viem.Chain
  if (!chain) {
    return null
  }
  if (chain.id === 1) {
    return _.set(_.cloneDeep(chain), 'rpcUrls.default.http.0', 'https://rpc-ethereum.g4mm4.io')
  } else if (chain.id === 369) {
    return _.set(_.cloneDeep(chain), 'rpcUrls.default.http.0', 'https://rpc-pulsechain.g4mm4.io')
  }
  return chain
}

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
      console.log(err)
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

const spinnerLimit = promiseLimit<any>(8)

const print = (key: string) => {
  const log = (w: string) => {
    console.log(`${w} %o`, key)
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
  }
}

export const spinner = async <T>(key: string, fn: () => Promise<T>) => {
  return spinnerLimit(async () => {
    const spinner = process.env.FAKE_SPINNER
      ? print(key)
      : new Spinner().start(key)
    return await fn().then((res) => {
      spinner.succeed()
      return res
    }).catch((err) => {
      console.log(err)
      spinner.failed()
      throw err
    })
  })
}

export const chainIdToNetworkId = (chainId: types.ChainId, type = 'evm') => (
  toKeccakBytes(`${type}${chainId}`)
)

export const erc20Read = async (chain: viem.Chain, client: viem.Client, target: viem.Hex) => {
  const calls = [
    { functionName: 'name' },
    { functionName: 'symbol' },
    { functionName: 'decimals' },
  ]
  return await multicallRead<[string, string, number]>({
    chain,
    client,
    abi: viem.erc20Abi,
    calls,
    target,
  })
    .catch(async () => {
      return await multicallRead<[viem.Hex, viem.Hex, number]>({
        chain,
        client,
        abi: viem.erc20Abi_bytes32,
        calls,
        target,
      })
        .then(
          ([name, symbol, decimals]) =>
            [
              viem.fromHex(name, 'string').split('\x00').join(''),
              viem.fromHex(symbol, 'string').split('\x00').join(''),
              decimals,
            ] as const,
        )
    })
    .catch(() => ['', '', 18] as const)
}

const folderAccessLimit = promiseLimit<any>(256)

export const folderContents = async (folder: string, fn: (i: string) => any) => {
  const blockchainFolders = removedUndesirable(await fs.promises.readdir(folder))
  return await folderAccessLimit.map(blockchainFolders, async (f) => fn(f))
}

export type Timeout = {
  timeoutId: () => NodeJS.Timeout;
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

export const toKeccakBytes = (s: string) => (
  viem.keccak256(viem.toBytes(s)).slice(2)
)
