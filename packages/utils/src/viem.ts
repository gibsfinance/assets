import {
  type Hex,
  type Chain,
  type Abi,
  getContract,
  multicall3Abi,
  encodeFunctionData,
  decodeFunctionResult,
  PublicClient,
  erc20Abi,
  erc20Abi_bytes32,
  fromHex,
  http,
  fallback,
  createPublicClient,
} from 'viem'
import type * as types from './types'

const rpcTimeout = 5_000

const defaultRpcOverrides: Record<number, string[]> = {
  1: ['https://cloudflare-eth.com', 'https://ethereum.publicnode.com', 'https://eth.llamarpc.com'],
  250: ['https://1rpc.io/ftm'],
}

/**
 * Build a viem transport for a chain with fallback load balancing.
 * Priority: RPC_{chainId} env var (comma-separated) > hardcoded overrides > chain defaults.
 * Uses viem's fallback transport with ranking for multiple RPCs.
 */
export const buildTransport = (chain: Chain) => {
  const envKey = `RPC_${chain.id}`
  const envUrls = process.env[envKey]?.split(',').filter(Boolean)
  const urls = envUrls?.length ? envUrls : (defaultRpcOverrides[chain.id] ?? chain.rpcUrls.default.http)

  if (urls.length === 1) {
    return http(urls[0], { timeout: rpcTimeout })
  }

  return fallback(
    urls.map((url) => http(url, { timeout: rpcTimeout })),
    { rank: false },
  )
}

const defaultBatchSettings = {
  multicall: {
    batchSize: 32,
    wait: 0,
  },
}

/**
 * Create a viem public client for a chain with fallback RPC load balancing.
 */
export const createChainClient = (chain: Chain): PublicClient => {
  return createPublicClient({
    chain,
    transport: buildTransport(chain),
    batch: defaultBatchSettings,
  }) as PublicClient
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
  chain: Chain
  client: PublicClient
  abi: Abi
  calls: types.Call[]
  target?: Hex
}) => {
  const multicall = getContract({
    abi: multicall3Abi,
    address: chain.contracts!.multicall3!.address!,
    client,
  })
  const arg = calls.map((call) => ({
    callData: encodeFunctionData({
      abi: call.abi || abi,
      functionName: call.functionName,
      args: call.args || [],
    }),
    allowFailure: call.allowFailure || false,
    target: (call.target || target) as Hex,
  }))
  const reads = await multicall.read.aggregate3([arg])
  return calls.map((call, i) =>
    decodeFunctionResult({
      abi: call.abi || abi,
      functionName: call.functionName,
      data: reads[i].returnData,
    }),
  ) as T
}

/**
 * ERC20 token data reader with fallback support
 */
const erc20ReadTimeout = 15_000

export const erc20Read = async (
  chain: Chain,
  client: PublicClient,
  target: Hex,
  {
    skipBytes32 = false,
    mustExist = false,
    signal,
  }: { skipBytes32?: boolean; mustExist?: boolean; signal?: AbortSignal } = {},
) => {
  if (signal?.aborted) throw signal.reason
  const calls = [{ functionName: 'name' }, { functionName: 'symbol' }, { functionName: 'decimals' }]
  const result = Promise.race([
    multicallRead<types.TokenChainInfo>({
      chain,
      client,
      abi: erc20Abi,
      calls,
      target,
    }).catch(async (err) => {
      if (skipBytes32) {
        throw err
      }
      return await multicallRead<[Hex, Hex, number]>({
        chain,
        client,
        abi: erc20Abi_bytes32,
        calls,
        target,
      }).then(
        ([name, symbol, decimals]) =>
          [
            fromHex(name, 'string').split('\x00').join(''),
            fromHex(symbol, 'string').split('\x00').join(''),
            decimals,
          ] as types.TokenChainInfo,
      )
    }),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`erc20Read timeout: ${chain.id} ${target}`)),
        erc20ReadTimeout,
      )
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(signal.reason)
        },
        { once: true },
      )
    }),
  ])
  return await result.catch((err) => {
    if (signal?.aborted) throw signal.reason
    if (mustExist) {
      throw new Error('unable to read token')
    }
    return ['', '', 18] as types.TokenChainInfo
  })
}
