import {
  type Hex,
  type Chain,
  type Abi,
  type Transport,
  type EIP1193RequestFn,
  getContract,
  multicall3Abi,
  encodeFunctionData,
  decodeFunctionResult,
  PublicClient,
  erc20Abi,
  erc20Abi_bytes32,
  fromHex,
  http,
  createTransport,
  shouldThrow,
  createPublicClient,
} from 'viem'
import type * as types from './types'

const rpcTimeout = 5_000

const defaultRpcOverrides: Record<number, string[]> = {
  1: ['https://cloudflare-eth.com', 'https://ethereum.publicnode.com', 'https://eth.llamarpc.com'],
  250: ['https://1rpc.io/ftm'],
}

/**
 * Round-robin load-balancing transport with failover.
 *
 * viem's built-in `fallback` transport is failover-only: every request hits the
 * first endpoint and only moves on when one errors, so it never spreads load.
 * This transport advances a per-request cursor instead, so consecutive requests
 * are distributed evenly across all endpoints — multiplying the combined
 * rate-limit headroom during a large collect run — while still falling through
 * the remaining endpoints in rotation whenever one fails.
 *
 * Error handling reuses viem's own `shouldThrow`: node-level answers (execution
 * reverts, user rejections) propagate immediately rather than being pointlessly
 * retried against every other endpoint, whereas connection failures and rate
 * limits (for example a 429) fail over to the next endpoint in the rotation.
 *
 * @param urls - The endpoint URLs to balance across (two or more).
 * @param options - Per-endpoint request timeout in milliseconds.
 */
export const loadBalance =
  (urls: readonly string[], { timeout }: { timeout: number }): Transport =>
  (params) => {
    // Instantiate each endpoint once (http transports are stateless closures);
    // retryCount 0 lets a failing endpoint fail over immediately rather than
    // retrying the same dead node before the rotation moves on.
    const endpoints = urls.map((url) => http(url, { timeout, retryCount: 0 })(params))
    let cursor = 0
    return createTransport(
      {
        key: 'loadBalance',
        name: 'Round-robin load balancer',
        type: 'loadBalance',
        // Let viem's retry wrapper re-run the whole rotation on retriable errors;
        // each retry advances the cursor, so a retry also lands on a fresh endpoint.
        retryCount: params.retryCount,
        request: (async (args: Parameters<EIP1193RequestFn>[0]) => {
          const start = cursor
          cursor = (cursor + 1) % endpoints.length
          const tryEndpoint = async (offset: number): Promise<unknown> => {
            const endpoint = endpoints[(start + offset) % endpoints.length]
            try {
              return await endpoint.request(args)
            } catch (error) {
              if (shouldThrow(error as Error)) throw error
              if (offset === endpoints.length - 1) throw error
              return tryEndpoint(offset + 1)
            }
          }
          return tryEndpoint(0)
        }) as EIP1193RequestFn,
      },
      { transports: endpoints },
    )
  }

/**
 * Build a viem transport for a chain.
 * Priority: RPC_{chainId} env var (comma-separated) > hardcoded overrides > chain defaults.
 * A single resolved URL uses a plain http transport; multiple URLs use the
 * round-robin {@link loadBalance} transport (load balancing plus failover).
 */
export const buildTransport = (chain: Chain) => {
  const envKey = `RPC_${chain.id}`
  const envUrls = process.env[envKey]?.split(',').filter(Boolean)
  const urls = envUrls?.length ? envUrls : (defaultRpcOverrides[chain.id] ?? chain.rpcUrls.default.http)

  if (urls.length === 1) {
    return http(urls[0], { timeout: rpcTimeout })
  }

  return loadBalance(urls, { timeout: rpcTimeout })
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
      const timer = setTimeout(() => reject(new Error(`erc20Read timeout: ${chain.id} ${target}`)), erc20ReadTimeout)
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
