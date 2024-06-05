import * as chains from 'viem/chains'
import * as path from 'path'
import * as fileType from 'file-type'
import * as fs from 'fs'
import * as crypto from 'crypto'
import * as viem from 'viem'
import { fileURLToPath } from 'url'
import * as types from './types'
import _ from 'lodash'
import promiseLimit from 'promise-limit'
import { setTimeout } from 'timers/promises'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const root = path.join(__dirname, '..')
const images = path.join(root, 'images')
const links = path.join(root, 'links')

const outRoot = process.env.OUT_ROOT || ''

export const paths = {
  root,
  images,
  links,
}

type ChainId = number | bigint | viem.Hex

const defaultImageOptions = {
  version: 'latest',
  ext: 'svg',
  outRoot: false,
  setLatest: false,
}

type ImageOptions = Partial<typeof defaultImageOptions>

const defaultListOptions = {
  logoURI: '',
  // name: '',
  version: {
    major: 0,
    minor: 0,
    patch: 0,
  }
}

enum ImageUpdateStatus {
  MATCHES_SPECIFIC,
  MATCHES_LATEST,
  MATCHES_BOTH,
  MATCHES_NEITHER,
}

export const pathFromOutRoot = (filePath: string) => {
  return filePath.split(root).join(outRoot)
}

export const updateImage = (
  specificPath: string,
  image: Buffer,
  writeLatest = false,
): ImageUpdateStatus => {
  const newHash = calculateHash(image)
  const folder = path.dirname(specificPath)
  fs.mkdirSync(folder, {
    recursive: true,
  })
  const ext = path.extname(specificPath)
  const latestPath = path.join(folder, `latest${ext}`)
  if (fs.existsSync(specificPath)) {
    if (!writeLatest) {
      return ImageUpdateStatus.MATCHES_SPECIFIC
    }
    const latestImage = fs.readFileSync(latestPath)
    const latestHash = calculateHash(latestImage)
    if (latestHash === newHash) {
      // if it is latest, then we early return
      // we have the latest
      return ImageUpdateStatus.MATCHES_BOTH
    }
    fs.writeFileSync(latestPath, image)
    return ImageUpdateStatus.MATCHES_SPECIFIC
  }
  fs.writeFileSync(specificPath, image)
  fs.writeFileSync(latestPath, image)
  return ImageUpdateStatus.MATCHES_NEITHER
}

export const networkImage = {
  path: (chainId: ChainId, options: ImageOptions = {}) => {
    const opts = {
      ...defaultImageOptions,
      ...options,
    }
    const fullChainId = viem.toHex(chainId, { size: 32 })
    return path.join(images, 'networks', fullChainId, `${opts.version}.${opts.ext}`)
  },
  update: async (chainId: ChainId, image: Buffer, options: ImageOptions = {}): Promise<ImageUpdateResult> => {
    const newHash = calculateHash(image)
    const type = await fileType.fileTypeFromBuffer(image)
    const ext = type?.ext
    const specificPath = networkImage.path(chainId, {
      ...defaultImageOptions,
      ext,
      ...options,
      version: newHash,
    })
    return {
      path: specificPath,
      status: updateImage(specificPath, image, options.setLatest),
    }
  },
}

export const providerImage = {
  path: (key: string, options: ImageOptions = {}) => {
    const opts = {
      ...defaultImageOptions,
      ...options,
    }
    return path.join(images, 'providers', key, `${opts.version}.${opts.ext}`)
  },
  update: async (key: string, image: Buffer, options: ImageOptions = {}): Promise<ImageUpdateResult> => {
    const newHash = calculateHash(image)
    const type = await fileType.fileTypeFromBuffer(image)
    const ext = type?.ext
    const specificPath = providerImage.path(key, {
      ...defaultImageOptions,
      ext,
      ...options,
      version: newHash,
    })
    return {
      path: specificPath,
      status: updateImage(specificPath, image, options.setLatest),
    }
  },
}

type ImageUpdateResult = {
  path: string
  status: ImageUpdateStatus
}

export const tokenImage = {
  path: (chainId: ChainId, address: string, options: ImageOptions = {}) => {
    const opts = {
      ...defaultImageOptions,
      ...options,
    }
    const fullChainId = viem.toHex(chainId, { size: 32 })
    const filePath = path.join(images, 'tokens', fullChainId, address, `${opts.version}.${opts.ext}`)
    if (opts.outRoot) {
      return pathFromOutRoot(filePath)
    }
    return filePath
  },
  update: async (
    chainId: ChainId, address: viem.Hex,
    image: Buffer, options: ImageOptions = {},
  ): Promise<ImageUpdateResult> => {
    const newHash = calculateHash(image)
    const type = await fileType.fileTypeFromBuffer(image)
    const ext = type?.ext
    const opts = {
      ...defaultImageOptions,
      ext,
      ...options,
      version: newHash,
    }
    const specificPath = tokenImage.path(chainId, address, opts)
    return {
      path: specificPath,
      status: updateImage(specificPath, image, opts.setLatest),
    }
  }
}

export const providerLink = {
  path: (providerKey: string, options = {}) => {
    const opts = {
      ...defaultImageOptions,
      ...options,
    }
    return path.join(links, 'providers', providerKey, `${opts.version}.${opts.ext}`)
  },
  update: async (providerKey: string, sortedEntries: types.TokenEntry[], options = {}): Promise<{ path: string }> => {
    const opts = {
      ...defaultListOptions,
      ...options,
    }
    const folder = path.join(links, providerKey)
    const file = path.join(folder, 'tokenlist.json')
    fs.mkdirSync(folder, {
      recursive: true,
    })
    const tokenList = {
      name: providerKey,
      timestamp: (new Date()).toISOString(),
      ...opts,
      tokens: sortedEntries,
      tokenMap: entiresToMap(sortedEntries),
    } as types.TokenList
    fs.writeFileSync(file, JSON.stringify(tokenList))
    return {
      path: file,
    }
  },
}

const entiresToMap = (entries: types.TokenEntry[]) => {
  return _.reduce(entries, (accumulator, entry) => {
    accumulator[`${entry.chainId}_${entry.address}`] = entry
    return accumulator
  }, {} as types.TokenMap)
}

export const toLinkPath = (chainId: ChainId, address?: string) => {
  const fullChainId = viem.toHex(chainId, { size: 32 })
  const addr = address && viem.getAddress(address)
  return path.join(links, fullChainId, `${addr || 'index'}.json`)
}

export const calculateHash = (buffer: Buffer): string => {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

export const responseToBuffer = async (res: Response) => (
  Buffer.from(await res.arrayBuffer())
)

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
  const reads = await multicall.read.aggregate3([
    arg
  ])
  // try {
  return calls.map((call, i) => (
    viem.decodeFunctionResult({
      abi: call.abi || abi,
      functionName: call.functionName,
      data: reads[i].returnData,
    })
  )) as T
  // } catch (err) {
  //   console.log(calls, reads, arg)
  //   throw err
  // }
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
      await setTimeout(opts.delay)
    }
  } while (opts.attempts)
  throw new Error('unable to complete task')
}

export const commonNativeNames = new Set<viem.Hex>([
  viem.zeroAddress,
  viem.getAddress('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
])
